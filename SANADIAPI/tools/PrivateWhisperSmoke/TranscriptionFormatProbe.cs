using System.Net.Http.Headers;
using System.Text.Json;
using Dapper;
using Sanadi.Infrastructure.Persistence;

// Synthetic audio only. No student data, credentials or transcript text in output.
internal static class TranscriptionFormatProbe
{
    internal static async Task Run(SqlConnectionFactory sql, HttpClient client, string syntheticWave)
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(55));
        await using var db = sql.Create();
        var settings = await db.QueryFirstOrDefaultAsync(DbProc.Call("usp_Assistant_GetAiSettings", null, deadline.Token));
        var endpoint = new UriBuilder((string)settings!.api_url);
        if (endpoint.Scheme != "https" || endpoint.Host != "inferencellm.uaeu.ac.ae")
            throw new InvalidOperationException("Only the configured university gateway is allowed.");
        var path = endpoint.Path.TrimEnd('/');
        foreach (var suffix in new[] { "/chat/completions", "/audio/speech", "/audio/transcriptions" })
            if (path.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)) { path = path[..^suffix.Length]; break; }
        endpoint.Path = path + "/audio/transcriptions";
        endpoint.Fragment = "";
        try
        {
            using var schemaRequest = new HttpRequestMessage(HttpMethod.Get, new Uri(endpoint.Uri, "/openapi.json"));
            schemaRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", (string)settings.api_key);
            using var schemaResponse = await client.SendAsync(schemaRequest, deadline.Token);
            using var schema = JsonDocument.Parse(await schemaResponse.Content.ReadAsStringAsync(deadline.Token));
            var root = schema.RootElement;
            var reference = root.GetProperty("paths").GetProperty(endpoint.Path).GetProperty("post")
                .GetProperty("requestBody").GetProperty("content").GetProperty("multipart/form-data")
                .GetProperty("schema").GetProperty("$ref").GetString()!.Split('/').Last();
            var properties = root.GetProperty("components").GetProperty("schemas").GetProperty(reference).GetProperty("properties");
            Console.WriteLine(JsonSerializer.Serialize(new { kind = "supported_form_fields",
                fields = properties.EnumerateObject().Select(p => p.Name).ToArray() }));
        }
        catch (Exception error)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { kind = "schema_unavailable", errorType = error.GetType().Name }));
        }
        var speech = await File.ReadAllBytesAsync(syntheticWave, deadline.Token);
        using var silenceStream = new MemoryStream();
        using (var writer = new BinaryWriter(silenceStream, System.Text.Encoding.ASCII, leaveOpen: true))
        {
            const int length = 16000 * 4 * 2;
            writer.Write("RIFF"u8); writer.Write(length + 36); writer.Write("WAVEfmt "u8);
            writer.Write(16); writer.Write((short)1); writer.Write((short)1);
            writer.Write(16000); writer.Write(32000); writer.Write((short)2); writer.Write((short)16);
            writer.Write("data"u8); writer.Write(length); writer.Write(new byte[length]);
        }
        foreach (var (name, wav, format) in new[] {
            ("silence", silenceStream.ToArray(), "json"),
            ("silence", silenceStream.ToArray(), "verbose_json"),
            ("speech", speech, "verbose_json") })
        {
            try
            {
                using var form = new MultipartFormDataContent();
                using var audio = new ByteArrayContent(wav);
                audio.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
                form.Add(audio, "file", "synthetic.wav");
                form.Add(new StringContent("whisper-large-v3"), "model");
                form.Add(new StringContent(format), "response_format");
                using var request = new HttpRequestMessage(HttpMethod.Post, endpoint.Uri) { Content = form };
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", (string)settings.api_key);
                request.Headers.Add("X-LLM-User-ID", Guid.NewGuid().ToString());
                using var response = await client.SendAsync(request, deadline.Token);
                using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(deadline.Token));
                var root = json.RootElement;
                Console.WriteLine(JsonSerializer.Serialize(new { name, format, status = (int)response.StatusCode,
                    fields = root.ValueKind == JsonValueKind.Object ? root.EnumerateObject().Select(p => p.Name).ToArray() : [],
                    textLength = root.TryGetProperty("text", out var text) ? text.GetString()?.Length : null,
                    segments = root.TryGetProperty("segments", out var segments) && segments.ValueKind == JsonValueKind.Array
                        ? segments.EnumerateArray().Select(s => new {
                            noSpeech = s.TryGetProperty("no_speech_prob", out var n) ? n.ToString() : null,
                            logProbability = s.TryGetProperty("avg_logprob", out var l) ? l.ToString() : null }).ToArray() : null }));
            }
            catch (Exception error)
            {
                Console.WriteLine(JsonSerializer.Serialize(new { name, format, errorType = error.GetType().Name }));
                Environment.ExitCode = 1;
            }
        }
    }
}
