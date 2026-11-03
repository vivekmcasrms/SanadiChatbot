using System.Text.Json;
using System.Text.RegularExpressions;
using Sanadi.Domain.Exceptions;

namespace Sanadi.Infrastructure.AppFunctions;

/// <summary>Validation at the C# boundary; browser validation is never trusted.</summary>
public sealed class FunctionInput(JsonElement value)
{
    public JsonElement Value { get; } = value.ValueKind == JsonValueKind.Object
        ? value : throw new SanadiException("Expected object");

    public string String(string name, int min = 0, int max = int.MaxValue)
    {
        if (!Value.TryGetProperty(name, out var item) || item.ValueKind != JsonValueKind.String)
            throw new SanadiException($"{name}: Expected string");
        var text = item.GetString()!;
        if (text.Length < min || text.Length > max)
            throw new SanadiException($"{name}: String must contain between {min} and {max} character(s)");
        return text;
    }

    public string? NullableString(string name, int max = int.MaxValue) =>
        Value.TryGetProperty(name, out var item) && item.ValueKind == JsonValueKind.Null
            ? null : String(name, max: max);

    public string Uuid(string name)
    {
        var text = String(name);
        if (!Regex.IsMatch(text, @"\A[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\z"))
            throw new SanadiException($"{name}: Invalid uuid");
        return text;
    }

    public string? NullableUuid(string name) =>
        Value.TryGetProperty(name, out var item) && item.ValueKind == JsonValueKind.Null ? null : Uuid(name);

    public int Int(string name, int min, int max, int? fallback = null)
    {
        if (!Value.TryGetProperty(name, out var item) && fallback.HasValue) return fallback.Value;
        if (item.ValueKind != JsonValueKind.Number || !item.TryGetDecimal(out var number)
            || decimal.Truncate(number) != number || number < min || number > max)
            throw new SanadiException($"{name}: Expected integer between {min} and {max}");
        return (int)number;
    }

    public bool Bool(string name)
    {
        if (!Value.TryGetProperty(name, out var item) || item.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            throw new SanadiException($"{name}: Expected boolean");
        return item.GetBoolean();
    }

    public bool Has(string name) => Value.TryGetProperty(name, out _);
    public string? OptionalString(string name, int max = int.MaxValue, bool nullable = false) =>
        !Has(name) ? null : nullable ? NullableString(name, max) : String(name, max: max);
    public string Enum(string name, string[] values, string? fallback = null)
    {
        var item = !Has(name) && fallback is not null ? fallback : String(name);
        return values.Contains(item) ? item : throw new SanadiException($"{name}: Invalid enum value");
    }
    public double Number(string name, double min = double.MinValue, double max = double.MaxValue, double? fallback = null)
    {
        if (!Has(name) && fallback.HasValue) return fallback.Value;
        if (!Value.TryGetProperty(name, out var item) || item.ValueKind != JsonValueKind.Number
            || !item.TryGetDouble(out var number) || !double.IsFinite(number) || number < min || number > max)
            throw new SanadiException($"{name}: Expected number between {min} and {max}");
        return number;
    }
    public string[] Strings(string name, int max = int.MaxValue, bool optional = false)
    {
        if (!Has(name) && optional) return [];
        if (!Value.TryGetProperty(name, out var item) || item.ValueKind != JsonValueKind.Array || item.GetArrayLength() > max
            || item.EnumerateArray().Any(x => x.ValueKind != JsonValueKind.String)) throw new SanadiException($"{name}: Expected string array");
        return item.EnumerateArray().Select(x => x.GetString()!).ToArray();
    }
}
