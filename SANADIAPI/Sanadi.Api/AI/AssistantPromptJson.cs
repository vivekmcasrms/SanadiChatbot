using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Unicode;

namespace Sanadi.Api.AI;

// JSON embedded inside an LLM prompt is text, not a second JSON transport. Keep
// Unicode readable while still quoting/escaping data; otherwise Arabic reaches
// the model as literal backslash-u sequences. HTTP JSON encoding is unchanged.
internal static class AssistantPromptJson
{
    private static readonly JsonSerializerOptions Options = new()
    {
        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All)
    };

    internal static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);
}
