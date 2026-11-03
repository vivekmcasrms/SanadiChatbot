namespace Sanadi.Infrastructure.Options;

public sealed class SqlOptions
{
    public const string Section = "SqlServer";
    public string ConnectionString { get; set; } = "";
}

public sealed class JwtOptions
{
    public const string Section = "Jwt";
    public string Issuer { get; set; } = "SanadiApi";
    public string Audience { get; set; } = "SanadiApp";
    public string SigningKey { get; set; } = "";
    public int AccessTokenMinutes { get; set; } = 60;
    public int RefreshTokenDays { get; set; } = 14;
}

public sealed class ApiKeyOptions
{
    public const string Section = "ApiKeys";
    public string PublishableKey { get; set; } = "sanadi-anon";
    public string ServiceRoleKey { get; set; } = "";
}

public sealed class StorageOptions
{
    public const string Section = "Storage";
    public string RootPath { get; set; } = "App_Data/storage";
    // Bound from Storage:PublicBaseUrl in appsettings.json (including environment overrides).
    public string PublicBaseUrl { get; set; } = "";
}
