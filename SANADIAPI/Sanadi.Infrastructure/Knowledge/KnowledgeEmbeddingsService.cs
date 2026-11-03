using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Dapper;
using System.Globalization;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Knowledge;

public sealed class KnowledgeEmbeddingsService(IHttpClientFactory httpClientFactory, IEmbeddingSettingsProvider settingsProvider)
{
    private const int MaxChars = 8000;
    private const int Batch = 64;

    private static string ToLiteral(IReadOnlyList<double> vec) =>
        "[" + string.Join(",", vec.Select(v => v.ToString("F6", CultureInfo.InvariantCulture))) + "]";

    public async Task<string?> EmbedQueryAsync(string query, CancellationToken ct = default)
    {
        var batch = await EmbedBatchAsync([query], ct);
        return batch is { Count: > 0 } && batch[0] is not null ? ToLiteral(batch[0]!) : null;
    }

    public async Task<List<string?>> EmbedTextsAsync(IReadOnlyList<string> texts, CancellationToken ct = default)
    {
        var outList = Enumerable.Repeat<string?>(null, texts.Count).ToList();
        for (var i = 0; i < texts.Count; i += Batch)
        {
            var slice = texts.Skip(i).Take(Batch).ToList();
            var vectors = await EmbedBatchAsync(slice, ct);
            if (vectors is null) continue;
            for (var j = 0; j < vectors.Count; j++)
                if (vectors[j] is not null) outList[i + j] = ToLiteral(vectors[j]!);
        }
        return outList;
    }

    public async Task<int> EmbedChunkRowsAsync(
        System.Data.Common.DbConnection db,
        string table,
        IReadOnlyList<(Guid Id, string Content, string? SectionTitle, string? Title)> rows,
        CancellationToken ct = default)
    {
        if (rows.Count == 0) return 0;
        var texts = rows.Select(r => string.Join("\n", new[] { r.Title, r.SectionTitle, r.Content }.Where(s => !string.IsNullOrWhiteSpace(s))).Trim()).ToList();
        var vectors = await EmbedTextsAsync(texts, ct);
        var done = 0;
        for (var i = 0; i < rows.Count; i++)
        {
            var vec = vectors[i];
            if (vec is null) continue;
            var proc = table == "web_page_chunks"
                ? "usp_Knowledge_Embeddings_UpdateWebPageChunk"
                : "usp_Knowledge_Embeddings_UpdateDocumentChunk";
            var n = await db.ExecuteAsync(DbProc.Call(proc, new { vec, id = rows[i].Id }, ct));
            if (n > 0) done++;
        }
        return done;
    }

    public async Task<EmbeddingBackfillResult> BackfillAsync(System.Data.Common.DbConnection db, int limit, CancellationToken ct = default)
    {
        limit = Math.Clamp(limit, 1, 500);
        var docRows = (await db.QueryAsync<(Guid id, string content, string? section_title)>(
            DbProc.Call("usp_Knowledge_Embeddings_ListUnembeddedDocChunks", new { limit }, ct))).ToList();
        var documents = await EmbedChunkRowsAsync(db, "document_chunks",
            docRows.Select(r => (r.id, r.content, r.section_title, (string?)null)).ToList(), ct);

        var webRows = (await db.QueryAsync<(Guid id, string content, string? section_title, string? page_title)>(
            DbProc.Call("usp_Knowledge_Embeddings_ListUnembeddedWebChunks", new { limit }, ct))).ToList();
        var web = await EmbedChunkRowsAsync(db, "web_page_chunks",
            webRows.Select(r => (r.id, r.content, r.section_title, r.page_title)).ToList(), ct);

        return new EmbeddingBackfillResult(documents, web);
    }

    private async Task<List<double[]?>?> EmbedBatchAsync(IReadOnlyList<string> inputs, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        try
        {
            var settings = await settingsProvider.LoadAsync(ct);
            if (settings is null || string.IsNullOrWhiteSpace(settings.Model)
                || !Uri.TryCreate(settings.ApiUrl?.Trim(), UriKind.Absolute, out var endpoint)
                || (endpoint.Scheme != Uri.UriSchemeHttp && endpoint.Scheme != Uri.UriSchemeHttps)) return null;
            var provider = settings.Provider.Trim().ToLowerInvariant();
            var model = settings.Model.Trim();
            var key = settings.ApiKey?.Trim();
            var gemini = provider is "gemini" or "google";
            var nativeOllama = provider == "ollama" && !endpoint.AbsolutePath.Contains("/v1", StringComparison.OrdinalIgnoreCase);
            if (!gemini && provider is not ("openai" or "lovable" or "custom" or "ollama" or "azure" or "azure_openai")) return null;
            if (string.IsNullOrEmpty(key) && provider is not ("ollama" or "custom")) return null;
            var uri = new UriBuilder(endpoint);
            var path = uri.Path.TrimEnd('/');
            var texts = inputs.Select(t => t.Length > MaxChars ? t[..MaxChars] : t).ToArray();
            object body;
            if (gemini)
            {
                if (model.StartsWith("google/", StringComparison.Ordinal)) model = model[7..];
                if (model.StartsWith("models/", StringComparison.Ordinal)) model = model[7..];
                var modelPath = path.IndexOf("/models/", StringComparison.Ordinal);
                if (modelPath >= 0) path = path[..modelPath];
                uri.Path = path + "/models/" + Uri.EscapeDataString(model) + ":batchEmbedContents";
                body = new { requests = texts.Select(text => new {
                    model = "models/" + model,
                    content = new { parts = new[] { new { text } } }
                }) };
            }
            else if (nativeOllama)
            {
                var apiPath = path.LastIndexOf("/api", StringComparison.Ordinal);
                if (apiPath >= 0) path = path[..apiPath];
                uri.Path = path + "/api/embed";
                body = new { model, input = texts };
            }
            else
            {
                foreach (var suffix in new[] { "/chat/completions", "/embeddings", "/responses" })
                    if (path.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) { path = path[..^suffix.Length]; break; }
                if (provider is "azure" or "azure_openai")
                {
                    var deployment = path.IndexOf("/deployments/", StringComparison.OrdinalIgnoreCase);
                    if (deployment < 0) return null;
                    path = path[..deployment] + "/deployments/" + Uri.EscapeDataString(model);
                }
                uri.Path = path + "/embeddings";
                body = new { model, input = texts };
            }
            var client = httpClientFactory.CreateClient("KnowledgeEmbeddings");
            using var req = new HttpRequestMessage(HttpMethod.Post, uri.Uri);
            if (!string.IsNullOrEmpty(key))
            {
                if (gemini) req.Headers.Add("x-goog-api-key", key);
                else if (provider is "azure" or "azure_openai") req.Headers.Add("api-key", key);
                else req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
            }
            req.Content = JsonContent.Create(body);
            using var res = await client.SendAsync(req, ct);
            if (!res.IsSuccessStatusCode) return null;
            await using var stream = await res.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            if (!doc.RootElement.TryGetProperty(gemini || nativeOllama ? "embeddings" : "data", out var data)
                || data.ValueKind != JsonValueKind.Array || data.GetArrayLength() != inputs.Count)
                return null;
            var outList = new List<double[]?>(new double[inputs.Count][]);
            var position = 0;
            int? dimensions = null;
            foreach (var row in data.EnumerateArray())
            {
                var index = gemini || nativeOllama ? position++ : row.GetProperty("index").GetInt32();
                var values = nativeOllama ? row : row.GetProperty(gemini ? "values" : "embedding");
                var emb = values.EnumerateArray().Select(e => e.GetDouble()).ToArray();
                if (index < 0 || index >= outList.Count || outList[index] is not null
                    || emb.Length == 0 || emb.Any(v => !double.IsFinite(v))
                    || (dimensions is not null && dimensions != emb.Length)) return null;
                dimensions = emb.Length;
                outList[index] = emb;
            }
            return outList.All(x => x is not null) ? outList : null;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch
        {
            return null;
        }
    }
}
