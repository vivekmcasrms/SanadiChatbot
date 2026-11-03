using Sanadi.Application.Data;

namespace Sanadi.Api.Http;

public static class PostgrestQueryParser
{
    public static DataQueryRequest Parse(string table, string method, IQueryCollection query, IHeaderDictionary headers, object? payload)
    {
        var filters = new List<FilterOp>();
        var orGroups = new List<OrGroup>();
        var order = new List<OrderSpec>();
        var select = new List<string> { "*" };
        var embeds = new List<EmbedSpec>();
        int? limit = null, offset = null;

        foreach (var kv in query)
        {
            var key = kv.Key;
            // Duplicate keys (e.g. exception_date=gte.x&exception_date=lte.y) arrive as
            // StringValues with multiple entries. ToString() joins them with commas and
            // produced a single bogus filter that made SQL date compares throw 500.
            foreach (var raw in kv.Value)
            {
                if (raw is null) continue;
                if (key == "select")
                {
                    (select, embeds) = ParseSelect(raw);
                }
                else if (key == "order")
                {
                    foreach (var part in raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                    {
                        var bits = part.Split('.', StringSplitOptions.RemoveEmptyEntries);
                        order.Add(new OrderSpec
                        {
                            Column = bits[0],
                            Descending = bits.Any(b => b.Equals("desc", StringComparison.OrdinalIgnoreCase))
                        });
                    }
                }
                else if (key == "limit" && int.TryParse(raw, out var lim)) limit = lim;
                else if (key == "offset" && int.TryParse(raw, out var off)) offset = off;
                else if (key == "or")
                {
                    orGroups.Add(new OrGroup { Filters = ParseOr(raw) });
                }
                else if (key == "on_conflict")
                {
                    // handled after the loop via query["on_conflict"]
                }
                else if (raw.Contains('.', StringComparison.Ordinal))
                {
                    var (op, value) = ParseOp(raw);
                    filters.Add(new FilterOp { Column = key, Operator = op, Value = value });
                }
            }
        }

        var prefer = headers["Prefer"].ToString();
        var accept = headers.Accept.ToString();
        var onConflict = query["on_conflict"].ToString();
        return new DataQueryRequest
        {
            Table = table,
            Method = method,
            Select = select,
            Embeds = embeds,
            Filters = filters,
            OrFilters = orGroups,
            Order = order,
            Limit = limit,
            Offset = offset,
            PreferRepresentation = prefer.Contains("return=representation", StringComparison.OrdinalIgnoreCase),
            CountExact = prefer.Contains("count=exact", StringComparison.OrdinalIgnoreCase),
            HeadOnly = method.Equals("HEAD", StringComparison.OrdinalIgnoreCase),
            SingleObject = accept.Contains("vnd.pgrst.object", StringComparison.OrdinalIgnoreCase),
            Payload = payload,
            Upsert = prefer.Contains("resolution=merge-duplicates", StringComparison.OrdinalIgnoreCase)
                      || prefer.Contains("resolution=ignore-duplicates", StringComparison.OrdinalIgnoreCase)
                      || !string.IsNullOrWhiteSpace(onConflict),
            IgnoreDuplicates = prefer.Contains("resolution=ignore-duplicates", StringComparison.OrdinalIgnoreCase),
            OnConflict = string.IsNullOrWhiteSpace(onConflict)
                ? null
                : onConflict.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        };
    }

    private static (string Op, string Value) ParseOp(string raw)
    {
        var negated = raw.StartsWith("not.", StringComparison.OrdinalIgnoreCase);
        if (negated) raw = raw[4..];
        var dot = raw.IndexOf('.');
        if (dot < 0) return (negated ? "not." + raw : raw, "");
        var op = raw[..dot];
        var value = raw[(dot + 1)..];
        return (negated ? "not." + op : op, value);
    }

    private static (List<string> columns, List<EmbedSpec> embeds) ParseSelect(string raw)
    {
        var columns = new List<string>();
        var embeds = new List<EmbedSpec>();
        foreach (var token in SplitTop(raw))
        {
            var t = token.Trim();
            if (t.Length == 0) continue;
            if (t.Contains('('))
            {
                string? hint = null;
                var alias = t;
                if (t.Contains(':'))
                {
                    var colon = t.IndexOf(':');
                    alias = t[..colon];
                    var rest = t[(colon + 1)..];
                    var paren = rest.IndexOf('(');
                    hint = paren > 0 ? rest[..paren].Trim() : null;
                    t = alias + rest[paren..];
                }
                var open = t.IndexOf('(');
                var close = t.LastIndexOf(')');
                var inner = close > open ? t[(open + 1)..close] : "*";
                var name = t[..open];
                var (innerCols, innerEmbeds) = ParseSelect(inner);
                embeds.Add(new EmbedSpec
                {
                    Alias = name,
                    ForeignKeyHint = hint,
                    Columns = innerCols,
                    Embeds = innerEmbeds
                });
            }
            else columns.Add(t);
        }
        if (columns.Count == 0 && embeds.Count == 0) columns.Add("*");
        return (columns, embeds);
    }

    private static List<FilterOp> ParseOr(string raw)
    {
        var inner = raw.Trim();
        if (inner.StartsWith('(') && inner.EndsWith(')')) inner = inner[1..^1];
        var filters = new List<FilterOp>();
        foreach (var token in SplitTop(inner))
        {
            var eq = token.IndexOf('.');
            if (eq <= 0) continue;
            var column = token[..eq];
            var (op, value) = ParseOp(token[(eq + 1)..]);
            filters.Add(new FilterOp { Column = column, Operator = op, Value = value });
        }
        return filters;
    }

    private static IEnumerable<string> SplitTop(string raw)
    {
        var depth = 0;
        var start = 0;
        for (var i = 0; i < raw.Length; i++)
        {
            var c = raw[i];
            if (c == '(') depth++;
            else if (c == ')') depth--;
            else if (c == ',' && depth == 0)
            {
                yield return raw[start..i];
                start = i + 1;
            }
        }
        if (start < raw.Length) yield return raw[start..];
    }
}
