using System.Text.RegularExpressions;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Infrastructure.Data;

public static class IdentifierGuard
{
    private static readonly Regex Safe = new("^[A-Za-z_][A-Za-z0-9_]*$", RegexOptions.Compiled);

    public static string Table(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 128 || !Safe.IsMatch(value))
            throw new SanadiException("Invalid table name.", 400, "invalid_identifier");
        return value;
    }

    public static string Column(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 128 || !Safe.IsMatch(value))
            throw new SanadiException("Invalid column name.", 400, "invalid_identifier");
        return value;
    }

    public static bool IsPath(string value)
    {
        var parts = value.Split('.');
        return parts.Length == 2 && Safe.IsMatch(parts[0]) && Safe.IsMatch(parts[1]);
    }

    public static string Bracket(string identifier) => $"[{Column(identifier)}]";
}
