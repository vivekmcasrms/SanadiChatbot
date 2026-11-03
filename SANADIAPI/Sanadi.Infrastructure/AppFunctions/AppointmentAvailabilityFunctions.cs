using System.Text.Json;
using Microsoft.Data.SqlClient;
using Sanadi.Application.Data;
using Sanadi.Application.Rpc;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;

namespace Sanadi.Infrastructure.AppFunctions;

/// <summary>Appointment publishing workflow, ported from appointments/availability.functions.ts.</summary>
public sealed class AppointmentAvailabilityFunctions(IDataQueryService data, IRpcExecutor rpc)
{
    private static FilterOp Eq(string column, string value) => new() { Column = column, Operator = "eq", Value = value };
    private static FilterOp SinceNow() => new() { Column = "start_time", Operator = "gte", Value = DateTimeOffset.UtcNow.ToString("O") };
    private static string? Text(JsonElement row, string key) => row.TryGetProperty(key, out var v) && v.ValueKind != JsonValueKind.Null ? v.ToString() : null;
    private static object? Field(JsonElement row, string key) => row.TryGetProperty(key, out var v) ? v : null;

    private Task<object?> Rpc(string name, object args, ICurrentUser user, CancellationToken ct) =>
        rpc.ExecuteAsync(name, JsonSerializer.SerializeToElement(args), user, ct);

    public async Task RequireAdmin(ICurrentUser user, CancellationToken ct)
    {
        if (!user.IsAuthenticated || user.UserId is null) throw new UnauthorizedException();
        // Use the same role lookup as the original handler, rather than stale JWT roles.
        var allowed = await Rpc("has_role", new { _user_id = user.UserId, _role = "system_admin" }, user, ct);
        if (allowed is not true) throw new ForbiddenException("Administrator access required.");
    }

    private async Task<JsonElement[]> Read(string table, string columns, ICurrentUser user, CancellationToken ct,
        IReadOnlyList<FilterOp>? filters = null, string? order = null)
    {
        try
        {
            var result = await data.ExecuteAsync(new DataQueryRequest
            {
                Table = table, Select = columns.Split(',').Select(s => s.Trim()).ToArray(),
                Filters = filters ?? [], Order = order is null ? [] : [new OrderSpec { Column = order }]
            }, user, ct);
            var json = JsonSerializer.SerializeToElement(result.Data);
            return json.ValueKind == JsonValueKind.Array ? json.EnumerateArray().ToArray() : [];
        }
        catch (Exception ex) when (ex is SanadiException or SqlException)
        {
            // The original Supabase reads use data ?? [] and deliberately ignore query errors.
            return [];
        }
    }

    private Task<DataQueryResult> Write(string table, object payload, ICurrentUser user, CancellationToken ct,
        IReadOnlyList<FilterOp>? filters = null, bool insert = false, bool returning = false) =>
        data.ExecuteAsync(new DataQueryRequest
        {
            Table = table, Method = insert ? "POST" : "PATCH", Payload = payload,
            Filters = filters ?? [], PreferRepresentation = returning, SingleObject = returning,
            Select = returning ? ["id"] : ["*"]
        }, user, ct);

    private static async Task IgnoreQueryError(Func<Task> action)
    {
        try { await action(); }
        catch (Exception ex) when (ex is SanadiException or SqlException) { }
    }

    public async Task<object> Workspace(ICurrentUser user, CancellationToken ct)
    {
        await RequireAdmin(user, ct);
        var unitsTask = Read("service_units", "id,code,name_en,name_ar,appointment_enabled", user, ct, [Eq("is_active", "true")], "name_en");
        var rulesTask = Read("staff_availability_rules", "id,service_unit_id,staff_profile_id,appointment_type_id,weekday,start_minute,end_minute,slot_minutes,location,valid_from,valid_to,is_active", user, ct, order: "weekday");
        // Admin inventory must include seed rows: migration marked all existing types/slots
        // is_demo_record=1, while student booking SPs already surface them. Filtering here
        // made Published plans show "0 real times" despite hundreds of future slots.
        var typesTask = Read("appointment_types", "id,service_unit_id,name_en,name_ar,duration_minutes", user, ct, [Eq("is_active", "true")]);
        var slotsTask = Read("appointment_slots", "id,appointment_type_id,status,start_time", user, ct, [SinceNow()]);
        await Task.WhenAll(unitsTask, rulesTask, typesTask, slotsTask);
        var units = await unitsTask;
        var rules = await rulesTask;
        var types = await typesTask;
        var slots = await slotsTask;
        var ids = rules.Select(r => Text(r, "staff_profile_id")).Where(s => !string.IsNullOrEmpty(s)).Distinct().ToArray();
        var profiles = ids.Length == 0 ? [] : await Read("profiles", "id,full_name", user, ct,
            [new FilterOp { Column = "id", Operator = "in", Value = $"({string.Join(',', ids)})" }]);
        var published = rules.Length > 0
            ? rules.Select(r => MapRule(r, units, types, profiles, slots)).ToArray()
            // Seed created appointment_types + slots but never staff_availability_rules.
            // Fall back so Published plans lists the live inventory admins can manage.
            : types
                .Select(t => MapTypeAsPlan(t, units, slots))
                .Where(p => p is not null)
                .Cast<object>()
                .ToArray();
        return new
        {
            units = units.Select(u => new { id = Field(u, "id"), code = Field(u, "code"), nameEn = Field(u, "name_en"), nameAr = Field(u, "name_ar"), appointmentEnabled = Text(u, "appointment_enabled")?.Equals("True", StringComparison.OrdinalIgnoreCase) == true }),
            types = types.Select(t => new { id = Field(t, "id"), unitId = Field(t, "service_unit_id"), nameEn = Field(t, "name_en"), nameAr = Field(t, "name_ar"), durationMinutes = Field(t, "duration_minutes") }),
            rules = published,
            realSlotTotal = slots.Length
        };
    }

    private static object MapRule(JsonElement r, JsonElement[] units, JsonElement[] types, JsonElement[] profiles, JsonElement[] slots) => new
    {
        id = Field(r, "id"), unitId = Field(r, "service_unit_id"),
        unitName = units.Where(u => Text(u, "id") == Text(r, "service_unit_id")).Select(u => Text(u, "name_en")).FirstOrDefault() ?? "",
        staffName = profiles.Where(p => Text(p, "id") == Text(r, "staff_profile_id")).Select(p => Text(p, "full_name") ?? "").FirstOrDefault(),
        typeName = types.Where(t => Text(t, "id") == Text(r, "appointment_type_id")).Select(t => Text(t, "name_en")).FirstOrDefault(),
        weekday = Field(r, "weekday"), startMinute = Field(r, "start_minute"), endMinute = Field(r, "end_minute"),
        slotMinutes = Field(r, "slot_minutes"), location = Field(r, "location"), validFrom = Field(r, "valid_from"),
        validTo = Field(r, "valid_to"), isActive = Field(r, "is_active"),
        realSlots = Text(r, "appointment_type_id") is { } typeId ? slots.Count(s => Text(s, "appointment_type_id") == typeId) : 0
    };

    /// <summary>
    /// When no staff_availability_rules exist, expose each active type that still has
    /// future slots as a published plan row (schedule inferred from those slots).
    /// </summary>
    private static object? MapTypeAsPlan(JsonElement type, JsonElement[] units, JsonElement[] slots)
    {
        var typeId = Text(type, "id");
        if (typeId is null) return null;
        var typeSlots = slots.Where(s => Text(s, "appointment_type_id") == typeId).ToArray();
        if (typeSlots.Length == 0) return null;
        var duration = int.TryParse(Text(type, "duration_minutes"), out var d) && d > 0 ? d : 30;
        var window = InferWindow(typeSlots, duration);
        var unitId = Text(type, "service_unit_id");
        return new
        {
            id = typeId, unitId,
            unitName = units.Where(u => Text(u, "id") == unitId).Select(u => Text(u, "name_en")).FirstOrDefault() ?? "",
            staffName = (string?)null,
            typeName = Text(type, "name_en"),
            weekday = window.Weekday, startMinute = window.StartMinute, endMinute = window.EndMinute,
            slotMinutes = duration, location = (string?)null, validFrom = (string?)null,
            validTo = (string?)null, isActive = true,
            realSlots = typeSlots.Length
        };
    }

    private static (int Weekday, int StartMinute, int EndMinute) InferWindow(JsonElement[] typeSlots, int durationMinutes)
    {
        TimeZoneInfo dubai;
        try { dubai = TimeZoneInfo.FindSystemTimeZoneById("Arabian Standard Time"); }
        catch { dubai = TimeZoneInfo.FindSystemTimeZoneById("Asia/Dubai"); }

        var local = typeSlots
            .Select(s => Text(s, "start_time"))
            .Where(s => !string.IsNullOrEmpty(s) && DateTimeOffset.TryParse(s, out _))
            .Select(s => TimeZoneInfo.ConvertTime(DateTimeOffset.Parse(s!), dubai))
            .ToArray();
        if (local.Length == 0) return (1, 9 * 60, 9 * 60 + durationMinutes);

        var byDay = local.GroupBy(t => (int)t.DayOfWeek).OrderByDescending(g => g.Count()).First();
        var startMinute = byDay.Min(t => t.Hour * 60 + t.Minute);
        var endMinute = byDay.Max(t => t.Hour * 60 + t.Minute) + durationMinutes;
        if (endMinute <= startMinute) endMinute = startMinute + durationMinutes;
        if (endMinute > 1440) endMinute = 1440;
        return (byDay.Key, startMinute, endMinute);
    }

    public async Task<object> Staff(FunctionInput input, ICurrentUser user, CancellationToken ct)
    {
        var unitId = input.Uuid("unitId");
        await RequireAdmin(user, ct);
        var staff = await Read("service_staff", "staff_profile_id", user, ct, [Eq("service_unit_id", unitId), Eq("is_active", "true")]);
        var ids = staff.Select(s => Text(s, "staff_profile_id")).Distinct().ToArray();
        if (ids.Length == 0) return Array.Empty<object>();
        var filter = $"({string.Join(',', ids)})";
        var profilesTask = Read("profiles", "id,full_name", user, ct, [new FilterOp { Column = "id", Operator = "in", Value = filter }]);
        var titlesTask = Read("staff_profiles", "user_id,job_title_en", user, ct, [new FilterOp { Column = "user_id", Operator = "in", Value = filter }]);
        await Task.WhenAll(profilesTask, titlesTask);
        var titles = await titlesTask;
        return (await profilesTask).Select(p => new
        {
            userId = Field(p, "id"), name = Text(p, "full_name") ?? Text(p, "id"),
            jobTitle = titles.Where(t => Text(t, "user_id") == Text(p, "id")).Select(t => Text(t, "job_title_en")).FirstOrDefault()
        });
    }

    public async Task<object> SetEnabled(FunctionInput input, ICurrentUser user, CancellationToken ct)
    {
        var unitId = input.Uuid("unitId");
        var enabled = input.Bool("enabled");
        await RequireAdmin(user, ct);
        await Write("service_units", new { appointment_enabled = enabled }, user, ct, [Eq("id", unitId)]);
        return new { ok = true };
    }

    public async Task<object> Create(FunctionInput input, ICurrentUser user, CancellationToken ct)
    {
        var unitId = input.Uuid("unitId");
        var staffId = input.NullableUuid("staffProfileId");
        var nameEn = input.String("serviceNameEn", 2, 80);
        var nameAr = input.String("serviceNameAr", 2, 80);
        var weekday = input.Int("weekday", 0, 6);
        var start = input.Int("startMinute", 0, 1439);
        var end = input.Int("endMinute", 1, 1440);
        var duration = input.Int("slotMinutes", 10, 240);
        var location = input.NullableString("location", 160);
        var validFrom = input.String("validFrom");
        var validTo = input.NullableString("validTo");
        var weeks = input.Int("weeks", 1, 12, 4);
        await RequireAdmin(user, ct);
        if (end <= start) throw new SanadiException("End time must be after the start time.");
        var existing = await Read("appointment_types", "id", user, ct,
            [Eq("service_unit_id", unitId), Eq("name_en", nameEn), Eq("duration_minutes", duration.ToString()), Eq("is_demo_record", "false")]);
        // maybeSingle returns no data when multiple rows match.
        var typeId = existing.Length == 1 ? Text(existing[0], "id") : null;
        if (typeId is null)
        {
            var created = await Write("appointment_types", new
            {
                service_unit_id = unitId, name_en = nameEn, name_ar = nameAr, duration_minutes = duration,
                location_type = string.IsNullOrEmpty(location) ? "online" : "in_person", is_active = true,
                data_source = "admin", is_demo_record = false
            }, user, ct, insert: true, returning: true);
            typeId = Text(JsonSerializer.SerializeToElement(created.Data), "id");
        }
        var rule = await Write("staff_availability_rules", new
        {
            service_unit_id = unitId, staff_profile_id = staffId, appointment_type_id = typeId,
            weekday, start_minute = start, end_minute = end, slot_minutes = duration, location,
            valid_from = validFrom, valid_to = validTo, created_by = user.UserId
        }, user, ct, insert: true, returning: true);
        var ruleId = Text(JsonSerializer.SerializeToElement(rule.Data), "id");
        await IgnoreQueryError(async () => { await Write("service_units", new { appointment_enabled = true }, user, ct, [Eq("id", unitId)]); });
        object? count = null;
        await IgnoreQueryError(async () => { count = await Rpc("generate_availability_slots", new { _rule_id = ruleId, _weeks = weeks }, user, ct); });
        return new { ok = true, ruleId, slotsCreated = Convert.ToInt32(count ?? 0) };
    }

    public async Task<object> Regenerate(FunctionInput input, ICurrentUser user, CancellationToken ct)
    {
        var ruleId = input.Uuid("ruleId");
        var weeks = input.Int("weeks", 1, 12, 4);
        await RequireAdmin(user, ct);
        var count = await Rpc("generate_availability_slots", new { _rule_id = ruleId, _weeks = weeks }, user, ct);
        return new { ok = true, slotsCreated = Convert.ToInt32(count ?? 0) };
    }

    public async Task<object> Deactivate(FunctionInput input, ICurrentUser user, CancellationToken ct)
    {
        var ruleId = input.Uuid("ruleId");
        await RequireAdmin(user, ct);
        var rules = await Read("staff_availability_rules", "appointment_type_id,staff_profile_id", user, ct, [Eq("id", ruleId)]);
        await Write("staff_availability_rules", new { is_active = false }, user, ct, [Eq("id", ruleId)]);
        if (rules.Length == 1 && Text(rules[0], "appointment_type_id") is { } typeId)
        {
            await IgnoreQueryError(async () => { await Write("appointment_slots", new { status = "closed" }, user, ct,
                [Eq("appointment_type_id", typeId), Eq("status", "open"), Eq("booked_count", "0"), SinceNow()]); });
        }
        return new { ok = true };
    }
}
