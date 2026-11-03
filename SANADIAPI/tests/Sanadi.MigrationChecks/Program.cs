using System.Text.Json;
using Sanadi.Application.Data;
using Sanadi.Application.Rpc;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;
using Sanadi.Infrastructure.AppFunctions;

var checks = new List<(string Name, Func<Task> Run)>();
var unitId = Guid.NewGuid().ToString();
var typeId = Guid.NewGuid().ToString();
var ruleId = Guid.NewGuid().ToString();
var actor = new TestUser(Guid.NewGuid());
FunctionInput Input(object value) => new(JsonSerializer.SerializeToElement(value));
object Rule(int start = 540, int end = 720, object? weeks = null) => new
{
    unitId, staffProfileId = (string?)null, serviceNameEn = "Advising", serviceNameAr = "إرشاد",
    weekday = 1, startMinute = start, endMinute = end, slotMinutes = 30,
    location = (string?)null, validFrom = "2026-09-17", validTo = (string?)null,
    weeks = weeks ?? 4
};
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
async Task Reject<T>(Func<Task> action) where T : Exception
{
    try { await action(); } catch (T) { return; }
    throw new Exception($"Expected {typeof(T).Name}");
}

checks.Add(("Anonymous and non-admin callers cannot publish or read availability", async () =>
{
    var data = new FakeData(); var rpc = new FakeRpc { Admin = false };
    var service = new AppointmentAvailabilityFunctions(data, rpc);
    await Reject<UnauthorizedException>(() => service.Workspace(new TestUser(null), default));
    await Reject<ForbiddenException>(() => service.Create(Input(Rule()), actor, default));
    Check(data.Calls.Count == 0, "Denied callers must not access tables");
}));
checks.Add(("Invalid times and fractional weeks cause no writes", async () =>
{
    var data = new FakeData(); var rpc = new FakeRpc();
    var service = new AppointmentAvailabilityFunctions(data, rpc);
    await Reject<SanadiException>(() => service.Create(Input(Rule(720, 540)), actor, default));
    await Reject<SanadiException>(() => service.Create(Input(Rule(weeks: 1.5)), actor, default));
    await Reject<SanadiException>(() => service.Create(Input(Rule(weeks: 13)), actor, default));
    Check(data.Calls.Count == 0, "Validation must precede writes");
}));
checks.Add(("Creating availability reuses the matching type and attributes the rule to the caller", async () =>
{
    var data = new FakeData
    {
        Reply = request => request.Method == "GET" ? new[] { new { id = typeId } } : new { id = ruleId }
    };
    var rpc = new FakeRpc(); var service = new AppointmentAvailabilityFunctions(data, rpc);
    var result = JsonSerializer.SerializeToElement(await service.Create(Input(Rule()), actor, default));
    Check(result.GetProperty("slotsCreated").GetInt32() == 8, "Published count must come from slot generator");
    Check(!data.Calls.Any(c => c.Table == "appointment_types" && c.Method == "POST"), "Matching type must be reused");
    var insert = data.Calls.Single(c => c.Table == "staff_availability_rules" && c.Method == "POST");
    var payload = JsonSerializer.SerializeToElement(insert.Payload);
    Check(payload.GetProperty("created_by").GetGuid() == actor.UserId, "Caller must own the attribution");
    Check(payload.GetProperty("appointment_type_id").GetString() == typeId, "Rule must reference matching type");
    Check(data.Users.All(u => ReferenceEquals(u, actor)), "All data access must retain caller scope");
}));
checks.Add(("New types preserve admin provenance and online location defaults", async () =>
{
    var data = new FakeData
    {
        Reply = request => request.Method == "GET" ? Array.Empty<object>() : new { id = request.Table == "appointment_types" ? typeId : ruleId }
    };
    var service = new AppointmentAvailabilityFunctions(data, new FakeRpc());
    await service.Create(Input(Rule()), actor, default);
    var payload = JsonSerializer.SerializeToElement(data.Calls.Single(c => c.Table == "appointment_types" && c.Method == "POST").Payload);
    Check(payload.GetProperty("data_source").GetString() == "admin", "Published types must remain real admin data");
    Check(!payload.GetProperty("is_demo_record").GetBoolean(), "Published types must not become demo data");
    Check(payload.GetProperty("location_type").GetString() == "online", "Null location must stay online");
}));
checks.Add(("Create preserves tolerated generation failure; regenerate propagates it", async () =>
{
    var data = new FakeData { Reply = r => r.Method == "GET" ? new[] { new { id = typeId } } : new { id = ruleId } };
    var service = new AppointmentAvailabilityFunctions(data, new FakeRpc { FailGeneration = true });
    var result = JsonSerializer.SerializeToElement(await service.Create(Input(Rule()), actor, default));
    Check(result.GetProperty("slotsCreated").GetInt32() == 0, "Create must preserve zero count on query error");
    await Reject<SanadiException>(() => service.Regenerate(Input(new { ruleId }), actor, default));
}));
checks.Add(("Deactivation withdraws only future unbooked open slots", async () =>
{
    var data = new FakeData { Reply = r => r.Method == "GET" ? new[] { new { appointment_type_id = typeId, staff_profile_id = (string?)null } } : null };
    var service = new AppointmentAvailabilityFunctions(data, new FakeRpc());
    await service.Deactivate(Input(new { ruleId }), actor, default);
    var close = data.Calls.Single(c => c.Table == "appointment_slots");
    Check(close.Filters.Any(f => f.Column == "booked_count" && f.Operator == "eq" && f.Value == "0"), "Booked slots must be preserved");
    Check(close.Filters.Any(f => f.Column == "status" && f.Value == "open"), "Only open slots may close");
    Check(close.Filters.Any(f => f.Column == "start_time" && f.Operator == "gte"), "Past slots must remain");
    Check(close.Filters.Any(f => f.Column == "appointment_type_id" && f.Value == typeId), "Other appointment types must remain");
    Check(data.Calls.FindIndex(c => c.Table == "staff_availability_rules" && c.Method == "PATCH") < data.Calls.IndexOf(close), "Deactivate rule before withdrawing slots");
}));
checks.Add(("Missing rule does not close unrelated appointment slots", async () =>
{
    var data = new FakeData(); var service = new AppointmentAvailabilityFunctions(data, new FakeRpc());
    await service.Deactivate(Input(new { ruleId }), actor, default);
    Check(!data.Calls.Any(c => c.Table == "appointment_slots"), "Missing rule must never close arbitrary slots");
}));
checks.Add(("Workspace counts all future real slots including booked ones", async () =>
{
    var data = new FakeData
    {
        Reply = r => r.Table switch
        {
            "service_units" => new[] { new { id = unitId, code = "U", name_en = "Unit", name_ar = "وحدة", appointment_enabled = true } },
            "appointment_types" => new[] { new { id = typeId, service_unit_id = unitId, name_en = "Advising", name_ar = "إرشاد", duration_minutes = 30 } },
            "staff_availability_rules" => new[] { new { id = ruleId, service_unit_id = unitId, appointment_type_id = typeId, staff_profile_id = (string?)null, weekday = 1, is_active = true } },
            "appointment_slots" => new[] { new { appointment_type_id = typeId, status = "open" }, new { appointment_type_id = typeId, status = "booked" } },
            _ => Array.Empty<object>()
        }
    };
    var result = JsonSerializer.SerializeToElement(await new AppointmentAvailabilityFunctions(data, new FakeRpc()).Workspace(actor, default));
    Check(result.GetProperty("realSlotTotal").GetInt32() == 2, "Booked real slots remain in totals");
    Check(result.GetProperty("rules")[0].GetProperty("realSlots").GetInt32() == 2, "Rule count includes all slots of its type");
    Check(result.GetProperty("units")[0].GetProperty("appointmentEnabled").GetBoolean(), "Unit toggle response must be boolean");
    Check(!data.Calls.Single(c => c.Table == "appointment_slots").Filters.Any(f => f.Column == "status"), "Workspace must not filter booked slots");
    Check(!data.Calls.Single(c => c.Table == "appointment_slots").Filters.Any(f => f.Column == "is_demo_record"), "Admin workspace must not hide seed slots");
}));
checks.Add(("Workspace lists seed types as plans when availability rules are missing", async () =>
{
    var data = new FakeData
    {
        Reply = r => r.Table switch
        {
            "service_units" => new[] { new { id = unitId, code = "U", name_en = "Unit", name_ar = "وحدة", appointment_enabled = true } },
            "appointment_types" => new[] { new { id = typeId, service_unit_id = unitId, name_en = "Advising", name_ar = "إرشاد", duration_minutes = 30 } },
            "staff_availability_rules" => Array.Empty<object>(),
            "appointment_slots" => new[]
            {
                new { appointment_type_id = typeId, status = "open", start_time = "2026-09-28T09:00:00+04:00" },
                new { appointment_type_id = typeId, status = "open", start_time = "2026-09-28T09:30:00+04:00" }
            },
            _ => Array.Empty<object>()
        }
    };
    var result = JsonSerializer.SerializeToElement(await new AppointmentAvailabilityFunctions(data, new FakeRpc()).Workspace(actor, default));
    Check(result.GetProperty("rules").GetArrayLength() == 1, "Missing rules must fall back to typed inventory");
    Check(result.GetProperty("rules")[0].GetProperty("typeName").GetString() == "Advising", "Fallback plan must keep type name");
    Check(result.GetProperty("rules")[0].GetProperty("realSlots").GetInt32() == 2, "Fallback plan must count future slots");
    Check(result.GetProperty("realSlotTotal").GetInt32() == 2, "Seed slots must count toward realSlotTotal");
}));

checks.Add(("Voice rejects empty audio before contacting the configured adapter", async () =>
{
    var adapter = new FakeVoiceTranscriber();
    var service = new VoiceTranscriptionService(adapter);
    await Reject<SanadiException>(() => service.Transcribe(Input(new { audioBase64 = Convert.ToBase64String(new byte[100]) }), Guid.NewGuid(), default));
    Check(adapter.Calls == 0, "Empty recordings must not reach providers");
}));
checks.Add(("Voice preserves the configured adapter's transcript and login identity", async () =>
{
    var adapter = new FakeVoiceTranscriber { Text = " hello " };
    var user = Guid.NewGuid();
    var output = JsonSerializer.SerializeToElement(await new VoiceTranscriptionService(adapter)
        .Transcribe(Input(new { audioBase64 = Convert.ToBase64String(new byte[2048]), language = "ar" }), user, default));
    Check(output.GetProperty("text").GetString() == "hello", "A language preference must not translate the transcript");
    Check(adapter.Calls == 1 && adapter.UserId == user, "Use only the configured adapter with the logged-in user");
}));
checks.Add(("Voice propagates provider failure without cloud fallback", async () =>
{
    var adapter = new FakeVoiceTranscriber { Fail = true };
    await Reject<SanadiException>(() => new VoiceTranscriptionService(adapter)
        .Transcribe(Input(new { audioBase64 = Convert.ToBase64String(new byte[2048]) }), Guid.NewGuid(), default));
    Check(adapter.Calls == 1, "A failure must not replay audio through another provider");
}));
checks.Add(("An empty transcript does not trigger fallback", async () =>
{
    var adapter = new FakeVoiceTranscriber();
    var output = JsonSerializer.SerializeToElement(await new VoiceTranscriptionService(adapter)
        .Transcribe(Input(new { audioBase64 = Convert.ToBase64String(new byte[2048]) }), Guid.NewGuid(), default));
    Check(output.GetProperty("text").GetString() == "" && adapter.Calls == 1, "Silence must not fall back");
}));

foreach (var (name, run) in checks) { await run(); Console.WriteLine($"PASS {name}"); }
Console.WriteLine($"{checks.Count} migration checks passed.");

sealed class FakeData : IDataQueryService
{
    public List<DataQueryRequest> Calls { get; } = [];
    public List<ICurrentUser> Users { get; } = [];
    public Func<DataQueryRequest, object?> Reply { get; init; } = _ => Array.Empty<object>();
    public Task<DataQueryResult> ExecuteAsync(DataQueryRequest request, ICurrentUser user, CancellationToken ct)
    {
        Calls.Add(request); Users.Add(user);
        return Task.FromResult(new DataQueryResult { Data = Reply(request) });
    }
}
sealed class FakeRpc : IRpcExecutor
{
    public bool Admin { get; init; } = true;
    public bool FailGeneration { get; init; }
    public Task<object?> ExecuteAsync(string name, JsonElement args, ICurrentUser user, CancellationToken ct)
    {
        if (name == "has_role") return Task.FromResult<object?>(Admin);
        if (name == "generate_availability_slots")
            return FailGeneration ? throw new SanadiException("Generation failed") : Task.FromResult<object?>(8);
        throw new Exception($"Unexpected RPC: {name}");
    }
}
sealed record TestUser(Guid? UserId) : ICurrentUser
{
    public string? Email => null;
    public IReadOnlyList<string> Roles => [];
    public bool IsAuthenticated => UserId.HasValue;
    public bool IsServiceRole => false;
}
sealed class FakeVoiceTranscriber : IVoiceTranscriber
{
    public int Calls { get; private set; }
    public Guid UserId { get; private set; }
    public string Text { get; init; } = "";
    public bool Fail { get; init; }
    public Task<string> Transcribe(byte[] wav, Guid userId, CancellationToken ct, string language = "auto")
    {
        Calls++;
        UserId = userId;
        if (Fail) throw new SanadiException("Configured speech recognition failed.");
        return Task.FromResult(Text);
    }
}
