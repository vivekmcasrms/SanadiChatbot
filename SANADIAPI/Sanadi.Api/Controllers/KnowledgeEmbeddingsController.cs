using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Knowledge;

namespace Sanadi.Api.Controllers;

[ApiController]
public sealed class KnowledgeEmbeddingsController(KnowledgeEmbeddingsService embeddings) : ControllerBase
{
    public sealed record Input(string[] Texts);

    // Trusted server callers only; provider credentials never leave the API.
    [HttpPost("functions/v1/knowledge-embeddings")]
    [HttpPost("api/knowledge/embeddings")]
    public async Task<object> Embed([FromBody] Input input, CancellationToken ct)
    {
        if (!HttpContext.GetSanadiUser().IsServiceRole) throw new UnauthorizedException();
        if (input.Texts is null || input.Texts.Length is < 1 or > 64
            || input.Texts.Any(t => string.IsNullOrWhiteSpace(t) || t.Length > 8000))
            throw new SanadiException("Provide 1 to 64 non-empty texts of at most 8000 characters each.");
        return new { embeddings = await embeddings.EmbedTextsAsync(input.Texts, ct) };
    }
}
