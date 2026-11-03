using System.Text.Json.Serialization;

namespace Sanadi.Infrastructure.Knowledge;

/// <summary>
/// Public result shapes returned across the Api/Infrastructure assembly boundary.
/// Anonymous types are internal and break <c>dynamic</c> access from Sanadi.Api.
/// JsonPropertyName keeps the existing SPA field names (PropertyNamingPolicy is null).
/// </summary>
public sealed record WebCrawlPageOutcome(
    string Url, int Depth, bool Ok, string Status, string? Title, string? Language,
    int Chunks, int TextLength, string? Hash, string? Error);

public sealed record WebCrawlReport(
    int Discovered, int Fetched, int Indexed, int Failed, int Chunks, int Removed,
    IReadOnlyList<WebCrawlPageOutcome> Pages, IReadOnlyList<string> CollegeNames,
    string? Error, bool Truncated);

public sealed record WebChangeClassification(string ChangeType, double Percentage, string Summary);

public sealed record CollegeRefreshResult(int Found, int Stored, IReadOnlyList<string> Names);

public sealed record GroundingConflict(
    string Topic, string Severity, RetrievedSource One, RetrievedSource Two,
    string StatementOne, string StatementTwo);

public sealed record GroundingOutcome(
    IReadOnlyList<RetrievedSource> Passages,
    int CandidateCount,
    long DurationMs,
    string? Domain,
    string GroundingStatus,
    IReadOnlyList<GroundingConflict> Conflicts,
    bool CacheHit);

public sealed record EmbeddingBackfillResult(
    [property: JsonPropertyName("documents")] int Documents,
    [property: JsonPropertyName("web")] int Web);

public sealed record ConnectorToolResult(
    string Status,
    string? Source = null,
    string? RetrievedAt = null,
    string? DataFreshness = null,
    object? Data = null,
    object? MaskedFields = null,
    long LatencyMs = 0,
    Guid? ToolId = null,
    Guid? ConnectorId = null,
    string? Error = null);

public sealed record DocumentReprocessResult(
    [property: JsonPropertyName("documentId")] Guid DocumentId,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("source")] string Source,
    [property: JsonPropertyName("chunks")] int Chunks,
    [property: JsonPropertyName("sections")] IReadOnlyList<string> Sections,
    [property: JsonPropertyName("pages")] int? Pages,
    [property: JsonPropertyName("searchable")] bool Searchable,
    [property: JsonPropertyName("blockers")] IReadOnlyList<string> Blockers);

public sealed record ActivationCheck(
    [property: JsonPropertyName("label")] string Label,
    [property: JsonPropertyName("ok")] bool Ok,
    [property: JsonPropertyName("detail")] string Detail);

public sealed record ActivationProbe(
    [property: JsonPropertyName("question")] string Question,
    [property: JsonPropertyName("hit")] bool Hit,
    [property: JsonPropertyName("section")] string? Section,
    [property: JsonPropertyName("score")] double Score);

public sealed record DocumentActivateResult(
    [property: JsonPropertyName("documentId")] Guid DocumentId,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("activated")] bool Activated,
    [property: JsonPropertyName("checks")] IReadOnlyList<ActivationCheck> Checks,
    [property: JsonPropertyName("probes")] IReadOnlyList<ActivationProbe> Probes);
