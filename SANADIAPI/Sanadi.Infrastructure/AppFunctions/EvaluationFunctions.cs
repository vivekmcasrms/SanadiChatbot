using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Sanadi.Domain.Exceptions;
using Sanadi.Domain.Security;
using static Sanadi.Infrastructure.AppFunctions.FunctionData;
using static Sanadi.Infrastructure.AppFunctions.FunctionJson;

namespace Sanadi.Infrastructure.AppFunctions;

public sealed class EvaluationFunctions(FunctionData db)
{
    public const int MinimumSample = 5;
    private async Task Manager(ICurrentUser user, CancellationToken ct)
    {
        RequireUser(user);
        var admin = db.Rpc("has_role", new { _user_id = user.UserId, _role = "system_admin" }, user, ct, true);
        var manager = db.Rpc("is_manager", new { _user_id = user.UserId }, user, ct, true);
        await Task.WhenAll(admin, manager);
        if (await admin is not true && await manager is not true) throw new ForbiddenException("Forbidden");
    }

    internal static string DateIso(string input, bool endOfDay = false)
    {
        var value = endOfDay ? input + "T23:59:59" : input;
        var style = !endOfDay && System.Text.RegularExpressions.Regex.IsMatch(input, @"^\d{4}-\d{2}-\d{2}$") ? DateTimeStyles.AssumeUniversal : DateTimeStyles.None;
        if (!DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, style, out var date)) throw new SanadiException("Invalid time value");
        return date.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    }

    public async Task<object> Snapshot(FunctionInput input, ICurrentUser user, CancellationToken ct)
    {
        var from = input.OptionalString("from", nullable: true); var to = input.OptionalString("to", nullable: true);
        await Manager(user, ct);
        var args = new Dictionary<string, string>();
        if (!string.IsNullOrEmpty(from)) args["_from"] = DateIso(from);
        if (!string.IsNullOrEmpty(to)) args["_to"] = DateIso(to, true);
        var metrics = JsonSerializer.SerializeToNode(await db.Rpc("evaluation_metrics", args, user, ct))!.AsObject();
        var rows = await Task.WhenAll(
            db.Rows("university_services", "id,code,name_en,name_ar", Trusted, ct, [Eq("is_active", true)], [Order("name_en")]),
            db.Rows("service_baselines", "*", Trusted, ct),
            db.Rows("pilot_test_sessions", "*", Trusted, ct, order: [Order("tested_on", true)], limit: 500),
            db.Rows("cases", "university_service_id,status,created_at,resolved_at,closed_at", Trusted, ct,
                [Filter("deleted_at", "is", null), Filter("created_at", "gte", metrics["range"].S("from")), Filter("created_at", "lte", metrics["range"].S("to"))], limit: 20000));
        var bases = new Dictionary<string, JsonObject>();
        foreach (var b in rows[1]) bases[b.S("university_service_id") ?? ""] = JsonSerializer.SerializeToNode(new
        {
            id = b.S("id"), universityServiceId = b.S("university_service_id"), steps = b["steps"], forms = b["forms"], visits = b["visits"],
            fieldsRequested = b["fields_requested"], avgProcessingHours = b["avg_processing_hours"] is null ? (double?)null : b.N("avg_processing_hours"),
            staffTouchpoints = b["staff_touchpoints"], channels = b["channels"] ?? new JsonArray(), notes = b.S("notes"), updatedAt = b.S("updated_at")
        })!.AsObject();
        var services = rows[0].Select(s =>
        {
            var cases = rows[3].Where(c => !string.IsNullOrEmpty(c.S("university_service_id")) && c.S("university_service_id") == s.S("id")).ToArray();
            var completed = cases.Where(c => c.S("status") is "resolved" or "closed").ToArray();
            var hours = completed.Where(c => !string.IsNullOrEmpty(c.S("resolved_at") ?? c.S("closed_at"))).Select(c =>
                (DateTimeOffset.Parse(c.S("resolved_at") ?? c.S("closed_at")!, CultureInfo.InvariantCulture) - DateTimeOffset.Parse(c.S("created_at")!, CultureInfo.InvariantCulture)).TotalHours).ToArray();
            return JsonSerializer.SerializeToNode(new { id = s.S("id"), code = s.S("code"), nameEn = s.S("name_en"), nameAr = s.S("name_ar"),
                baseline = bases.GetValueOrDefault(s.S("id") ?? ""), cases = cases.Length, completed = completed.Length,
                avgResolutionHours = hours.Length == 0 ? (double?)null : Round(hours.Average(), 2) })!.AsObject();
        }).ToArray();
        var pilots = rows[2].Select(p => new { id = p.S("id"), universityServiceId = p.S("university_service_id"), serviceLabel = p.S("service_label"),
            participantRole = p.S("participant_role"), participantCount = p["participant_count"], testedOn = p.S("tested_on"), completedSuccessfully = p["completed_successfully"],
            timeTakenMinutes = p["time_taken_minutes"] is null ? (double?)null : p.N("time_taken_minutes"), issues = p.S("issues"), satisfactionRating = p["satisfaction_rating"], comments = p.S("comments") }).ToArray();
        return new { metrics, services, pilots, indicators = Indicators(metrics, services), readiness = Readiness(metrics, services, pilots.Length) };
    }

    public static object[] Indicators(JsonObject m, JsonObject[] services)
    {
        var completed = m["handling"].N("resolved") + m["handling"].N("closed"); var total = m["volumes"].N("cases");
        var withBase = services.Where(s => s["baseline"] is not null && s.N("cases") > 0).ToArray();
        var sampled = withBase.Sum(s => s.N("cases"));
        double? Avg(string key) { var vals = withBase.Where(s => s["baseline"]?[key] is not null).Select(s => s["baseline"].N(key)).ToArray(); return vals.Length == 0 ? null : vals.Average(); }
        double? Per(string key) => total > 0 ? m["effort"].N(key) / total : null;
        double? Reduction(double? before, double? after) => before is null or <= 0 || after is null ? null : Round((before.Value - after.Value) / before.Value * 100, 1);
        Dictionary<string, object?> Item(string key, string en, string ar, double sample, double? value) => new()
        { ["key"] = key, ["labelEn"] = en, ["labelAr"] = ar, ["unit"] = "percent", ["sample"] = sample, ["value"] = value };
        void Reason(Dictionary<string, object?> item, bool noBase = false)
        {
            item["reasonEn"] = noBase ? "No baseline recorded yet" : "Fewer than 5 comparable cases";
            item["reasonAr"] = noBase ? "لم يتم تسجيل خط أساس بعد" : "أقل من 5 حالات قابلة للمقارنة";
        }
        Dictionary<string, object?> ReductionItem(string key, string en, string ar, double? before, double? after, double sample, double gateSample)
        {
            var item = Item(key, en, ar, sample, before is null || gateSample < MinimumSample ? null : Reduction(before, after));
            item["baselineValue"] = before; item["currentValue"] = after;
            if (before is null) Reason(item, true); else if (gateSample < MinimumSample) Reason(item);
            return item;
        }
        Dictionary<string, object?> PercentItem(string key, string en, string ar, double numerator, double denominator, double sample)
        {
            var item = Item(key, en, ar, sample, denominator <= 0 || sample < MinimumSample ? null : Round(numerator / denominator * 100, 1));
            if (sample < MinimumSample) Reason(item); return item;
        }
        var repeat = m["effort"].N("reused_known_fields") + m["effort"].N("information_requests");
        return [
            ReductionItem("steps", "Reduction in steps", "تقليل الخطوات", Avg("steps"), Per("status_transitions"), sampled, sampled),
            ReductionItem("fields", "Reduction in fields requested", "تقليل الحقول المطلوبة", Avg("fieldsRequested"), Per("student_entered_fields"), sampled, sampled),
            ReductionItem("visits", "Reduction in in-person visits", "تقليل الزيارات الحضورية", Avg("visits"), Per("in_person_visits"), sampled, sampled),
            ReductionItem("processing_time", "Reduction in processing time", "تقليل زمن المعالجة", Avg("avgProcessingHours"), m["timing"]?["avg_resolution_hours"] is null ? null : m["timing"].N("avg_resolution_hours"), m["timing"].N("resolution_sample"), m["timing"].N("resolution_sample")),
            PercentItem("automation", "Automation rate (resolved without staff)", "نسبة الأتمتة (مغلقة دون تدخل موظف)", m["handling"].N("ai_resolved"), completed, completed),
            PercentItem("escalation", "Escalation rate", "نسبة التصعيد", m["handling"].N("human_escalated"), total, total),
            PercentItem("resolution", "Resolution rate", "نسبة الإنجاز", completed, total, total),
            PercentItem("sla", "SLA compliance", "الالتزام بمستوى الخدمة", m["sla"].N("met"), m["sla"].N("sample"), m["sla"].N("sample")),
            PercentItem("repeat_info", "Repeat-information reduction", "خفض تكرار طلب المعلومات", m["effort"].N("reused_known_fields"), repeat, repeat),
            PercentItem("reopen", "Reopen / objection rate", "نسبة إعادة الفتح أو الاعتراض", m["reviews"].N("reopen_or_objection"), m["reviews"].N("decided_sample"), m["reviews"].N("decided_sample"))
        ];
    }

    public static object[] Readiness(JsonObject m, JsonObject[] services, int pilots)
    {
        var ev = m["evidence"]!; var kinds = ev["reviews_by_kind"] as JsonObject ?? new();
        var completed = m["handling"].N("resolved") + m["handling"].N("closed"); var bases = services.Count(s => s["baseline"] is not null);
        object Crit(string key, string en, string ar, params (string En, string Ar, bool Ok)[] checks) => new
        {
            key, labelEn = en, labelAr = ar, status = checks.All(c => c.Ok) ? "complete" : checks.All(c => !c.Ok) ? "not_complete" : "partial",
            evidenceEn = checks.Where(c => c.Ok).Select(c => c.En), evidenceAr = checks.Where(c => c.Ok).Select(c => c.Ar),
            missingEn = checks.Where(c => !c.Ok).Select(c => c.En), missingAr = checks.Where(c => !c.Ok).Select(c => c.Ar)
        };
        var objections = new[] { "objection", "correction", "question", "reopen" }.Sum(k => kinds.N(k));
        return [
            Crit("governance", "Governance & Permissions", "الحوكمة والصلاحيات", ("Published permissions matrix for student, staff and admin", "مصفوفة صلاحيات منشورة", true), ($"Access withdrawal in use ({ev.N("revoked_accounts")} revoked accounts)", $"سحب الصلاحية مُفعّل ({ev.N("revoked_accounts")})", ev.N("revoked_accounts") > 0)),
            Crit("journey", "Customer Journey", "رحلة المتعامل", ($"{m["volumes"].N("cases")} requests captured end to end", $"{m["volumes"].N("cases")} طلبًا موثقًا من البداية للنهاية", m["volumes"].N("cases") > 0), ($"{completed} requests reached a recorded outcome", $"{completed} طلبًا وصل إلى نتيجة مسجلة", completed > 0)),
            Crit("nlp", "Natural Language", "اللغة الطبيعية", ($"{ev.N("assistant_conversations")} assistant conversations", $"{ev.N("assistant_conversations")} محادثة مع المساعد", ev.N("assistant_conversations") > 0), ($"{m["volumes"].N("chat_messages")} chat messages in range", $"{m["volumes"].N("chat_messages")} رسالة خلال الفترة", m["volumes"].N("chat_messages") > 0)),
            Crit("ask_once", "Ask Once", "اسأل مرة واحدة", ($"{ev.N("provenance_fields")} student fields reused from authorised sources", $"{ev.N("provenance_fields")} حقلاً أُعيد استخدامه من مصادر معتمدة", ev.N("provenance_fields") > 0)),
            Crit("transparency", "Transparency & Trust", "الشفافية والثقة", ($"{ev.N("action_receipts")} action receipts issued", $"{ev.N("action_receipts")} إيصال إجراء", ev.N("action_receipts") > 0), ($"{ev.N("issued_documents")} verifiable documents issued", $"{ev.N("issued_documents")} وثيقة قابلة للتحقق", ev.N("issued_documents") > 0)),
            Crit("approvals", "Approvals", "الموافقات", ($"{ev.N("approvals")} action-specific approvals recorded", $"{ev.N("approvals")} موافقة محددة مسجلة", ev.N("approvals") > 0)),
            Crit("continuity", "Continuity", "الاستمرارية", ($"{m["volumes"].N("conversations")} conversations restored across sessions", $"{m["volumes"].N("conversations")} محادثة تُستعاد بين الجلسات", m["volumes"].N("conversations") > 0), ($"{ev.N("handovers")} handover packages prepared for staff", $"{ev.N("handovers")} حزمة تسليم للموظفين", ev.N("handovers") > 0)),
            Crit("exceptions", "Exceptions", "الاستثناءات", ($"{ev.N("exception_events")} exceptions detected and recovered", $"{ev.N("exception_events")} استثناء تم رصده ومعالجته", ev.N("exception_events") > 0)),
            Crit("human", "Human Intervention", "التدخل البشري", ($"{m["handling"].N("human_escalated")} requests routed to a named staff member", $"{m["handling"].N("human_escalated")} طلبًا وُجّه إلى موظف محدد", m["handling"].N("human_escalated") > 0)),
            new { key = "payment", labelEn = "Payment", labelAr = "الدفع", status = "not_applicable", evidenceEn = new[] { "No Sanadi service charges a fee, so no payment step exists." }, evidenceAr = new[] { "لا توجد خدمة برسوم في سند، لذلك لا توجد خطوة دفع." }, missingEn = Array.Empty<string>(), missingAr = Array.Empty<string>() },
            Crit("objection", "Result & Objection", "النتيجة والاعتراض", ($"{completed} results presented to students", $"{completed} نتيجة عُرضت على الطلبة", completed > 0), ($"{objections} questions, corrections or objections handled", $"{objections} استفسار أو تصحيح أو اعتراض", kinds.Any(k => kinds.N(k.Key) > 0))),
            Crit("testing", "Testing & Measurement", "الاختبار والقياس", ($"{bases} service baselines recorded", $"{bases} خط أساس مسجل", bases > 0), ($"{pilots} pilot testing sessions recorded", $"{pilots} جلسة اختبار مسجلة", pilots > 0), ($"{completed} completed requests available for measurement", $"{completed} طلبًا مكتملًا متاحًا للقياس", completed >= MinimumSample))
        ];
    }

    private static double? NullableNumber(FunctionInput input, string name, bool integer = false, double min = 0, double max = double.MaxValue)
    {
        if (input.Value.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Null) return null;
        var n = input.Number(name, min, max);
        if (integer && Math.Truncate(n) != n) throw new SanadiException($"{name}: Expected integer");
        return n;
    }
    public async Task<object> SaveBaseline(FunctionInput input, ICurrentUser user, CancellationToken ct)
    {
        var id = input.Uuid("universityServiceId"); var channels = input.Strings("channels", 20);
        if (channels.Any(c => c.Length > 60)) throw new SanadiException("channels: String must contain at most 60 character(s)");
        var payload = new { university_service_id = id, steps = NullableNumber(input, "steps", true), forms = NullableNumber(input, "forms", true), visits = NullableNumber(input, "visits", true),
            fields_requested = NullableNumber(input, "fieldsRequested", true), avg_processing_hours = NullableNumber(input, "avgProcessingHours"), staff_touchpoints = NullableNumber(input, "staffTouchpoints", true),
            channels, notes = input.OptionalString("notes", 2000, true), recorded_by = user.UserId, updated_at = DateTimeOffset.UtcNow.ToString("O") };
        await Manager(user, ct);
        await db.Write("service_baselines", "POST", payload, user, ct, conflict: ["university_service_id"]);
        return new { ok = true };
    }
    public async Task<object> SavePilot(FunctionInput input, ICurrentUser user, CancellationToken ct)
    {
        var payload = new { university_service_id = input.Has("universityServiceId") ? input.NullableUuid("universityServiceId") : null, service_label = input.OptionalString("serviceLabel", 160, true),
            participant_role = input.String("participantRole", 1, 60), participant_count = input.Int("participantCount", 1, 1000), tested_on = input.String("testedOn", 1),
            completed_successfully = input.Bool("completedSuccessfully"), time_taken_minutes = NullableNumber(input, "timeTakenMinutes"), issues = input.OptionalString("issues", 2000, true),
            satisfaction_rating = NullableNumber(input, "satisfactionRating", true, 1, 5), comments = input.OptionalString("comments", 2000, true), recorded_by = user.UserId };
        await Manager(user, ct);
        await db.Write("pilot_test_sessions", "POST", payload, user, ct);
        return new { ok = true };
    }
    public async Task<object> Delete(FunctionInput input, bool pilot, ICurrentUser user, CancellationToken ct)
    {
        var id = input.Uuid("id"); await Manager(user, ct);
        await db.Write(pilot ? "pilot_test_sessions" : "service_baselines", "DELETE", null, user, ct, [Eq("id", id)]);
        return new { ok = true };
    }
}
