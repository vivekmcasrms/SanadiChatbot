using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Dapper;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Infrastructure.Appointments;

/// <summary>
/// Deterministic appointment booking turns for the C# assistant — mirrors the
/// Node Appointment Agent: clarify unit → optional AI-first offer → list real
/// slots by department → booking summary → confirmed book_appointment.
/// </summary>
public sealed class AppointmentChatService
{
    private static readonly Regex AppointmentRe = new(
        @"appointment|book(ing)?|reserve|slot|meet(ing)?|see (someone|a |an )|consultation|موعد|مواعيد|حجز|احجز|أحجز|مقابلة|أقابل|لقاء|استشارة",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex LibraryBookRe = new(
        @"\b(book|ebook|e-book|textbook|novel|read|library|catalogue|catalog|كتاب|كتب|مكتبة)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex HumanRe = new(
        @"\b(still (want|prefer|need)|just book|book (an? )?appointment|book (it|the appointment|me in)|no,? ?(book|i want)|in person|face to face|human please|speak to|talk to|see (someone|somebody))\b|احجز|موعد|أقابل|شخص",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex AcceptRe = new(
        @"\b(yes|yeah|yep|sure|ok(ay)?|please do|go ahead|help me|review|check my|show me|first)\b|نعم|أجل|تمام|موافق|ساعدني|راجع|تحقق|أولاً",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly (Regex Re, string Code)[] UnitHints =
    [
        (new(@"(career|job|cv|resume|employ|internship|alumni|مهني|وظيف|سيرة|تدريب)", RegexOptions.IgnoreCase | RegexOptions.Compiled), "CAREER"),
        (new(@"(accessib|disabilit|special needs|إعاقة|احتياجات خاصة)", RegexOptions.IgnoreCase | RegexOptions.Compiled), "ACCESS"),
        (new(@"(academic advis|advisor|adviser|advising|study plan|أكاديمي|مرشد|إرشاد)", RegexOptions.IgnoreCase | RegexOptions.Compiled), "ADV"),
        (new(@"(library|librarian|مكتبة)", RegexOptions.IgnoreCase | RegexOptions.Compiled), "LIB"),
        (new(@"(registr|admission|قبول|تسجيل)", RegexOptions.IgnoreCase | RegexOptions.Compiled), "REG"),
    ];

    public bool LooksLikeAppointment(string text, AppointmentContext? prior)
    {
        if (prior is { AwaitingService: true } or { AwaitingAssist: true } || (prior?.OfferedSlots?.Count > 0))
            return true;
        var t = text.Trim();
        if (t.Length == 0) return false;
        if (LibraryBookRe.IsMatch(t) && !Regex.IsMatch(t, @"appointment|موعد|حجز|meeting|meet with", RegexOptions.IgnoreCase))
            return false;
        return AppointmentRe.IsMatch(t);
    }

    public async Task<AppointmentTurnResult> HandleAsync(
        System.Data.Common.DbConnection conn, Guid userId, string text, string lang, AppointmentContext? prior, CancellationToken ct)
    {
        var ar = lang == "ar";
        var ctx = prior ?? new AppointmentContext();
        var t = text.Trim();

        // 1) Student is picking a previously offered slot → Booking Summary + propose.
        if (ctx.OfferedSlots is { Count: > 0 } slotList)
        {
            var picked = PickSlot(t, slotList);
            if (picked is not null)
            {
                var summary = BuildBookingSummary(picked, ar);
                var proposal = BookProposal(picked, ar);
                ctx.OfferedSlots = slotList;
                ctx.AwaitingAssist = false;
                ctx.AwaitingService = false;
                return new AppointmentTurnResult(summary, true, new JsonArray(proposal), ctx, "list_appointment_slots");
            }
        }

        // 2) Answering "which unit?"
        if (ctx.AwaitingService && ctx.ServiceOptions is { Count: > 0 })
        {
            var matched = MatchService(t, ctx.ServiceOptions);
            if (matched is null)
            {
                var again = ar
                    ? "لم أتأكد من الوحدة. اختر واحداً من القائمة:\n\n" + string.Join("\n", ctx.ServiceOptions.Select(s => $"- {s.Label}"))
                    : "I could not match that unit. Please choose one from the list:\n\n" + string.Join("\n", ctx.ServiceOptions.Select(s => $"- {s.Label}"));
                return new AppointmentTurnResult(again, true, new JsonArray(), ctx, "list_appointment_slots");
            }
            ctx.UnitCode = matched.UnitCode;
            ctx.UnitLabel = matched.Label;
            ctx.AwaitingService = false;
            return await AfterUnitKnown(conn, t, ar, ctx, ct);
        }

        // 3) Answering the AI-first offer.
        if (ctx.AwaitingAssist)
        {
            if (IsHumanPreference(t) || !AcceptRe.IsMatch(t))
            {
                ctx.AwaitingAssist = false;
                ctx.AssistOffered = true;
                return await ListSlotsAsync(conn, ar, ctx, ct);
            }
            ctx.AwaitingAssist = false;
            ctx.AssistOffered = true;
            var domain = AssistDomain(ctx.UnitCode);
            var accept = ar
                ? "حسناً — أخبرني بما تحتاج وسأساعدك هنا. يمكنك أيضاً قول «احجز موعداً» في أي وقت للعودة إلى الحجز."
                : "Okay — tell me what you need and I will help here. You can also say “book an appointment” any time to go back to booking.";
            if (domain == "career")
                accept = ar
                    ? "حسناً — يمكنني مراجعة سيرتك أو حساب درجة ATS أو اقتراح وظائف. ماذا تفضّل؟ أو قل «احجز موعداً» للمتابعة مع المستشار."
                    : "Okay — I can review your CV, calculate an ATS score, or suggest roles. What would you like, or say “book an appointment” to continue with a counsellor.";
            return new AppointmentTurnResult(accept, true, new JsonArray(), ctx, "list_appointment_slots");
        }

        // Fresh book request (or continue after assist with "book an appointment").
        var unitFromText = DetectUnitCode(t) ?? ctx.UnitCode;
        ctx.UnitCode = unitFromText;

        if (string.IsNullOrWhiteSpace(ctx.UnitCode))
        {
            var options = await ListBookableUnits(conn, ar, ct);
            if (options.Count == 0)
            {
                var none = ar
                    ? "لا تتوفر لديّ حالياً مواعيد لأي خدمة، ولن أعرض أوقاتاً غير حقيقية."
                    : "I don't currently have appointment availability for any service, and I will not show times that are not real.";
                return new AppointmentTurnResult(none, true, new JsonArray(), ctx, "list_appointment_slots");
            }
            ctx.AwaitingService = true;
            ctx.ServiceOptions = options;
            var clarify = ar
                ? "بالطبع. مع أي خدمة أو وحدة تود الاجتماع؟\n\n" + string.Join("\n", options.Select(s => $"- {s.Label}"))
                : "Of course. Which service or unit would you like to meet with?\n\n" + string.Join("\n", options.Select(s => $"- {s.Label}"));
            return new AppointmentTurnResult(clarify, true, new JsonArray(), ctx, "list_appointment_slots");
        }

        if (string.IsNullOrWhiteSpace(ctx.UnitLabel))
            ctx.UnitLabel = await UnitLabel(conn, ctx.UnitCode!, ar, ct) ?? ctx.UnitCode;

        return await AfterUnitKnown(conn, t, ar, ctx, ct);
    }

    private async Task<AppointmentTurnResult> AfterUnitKnown(
        System.Data.Common.DbConnection conn, string text, bool ar, AppointmentContext ctx, CancellationToken ct)
    {
        var domain = AssistDomain(ctx.UnitCode);
        var wantsHuman = IsHumanPreference(text) || Regex.IsMatch(text, @"book an appointment|احجز موعد", RegexOptions.IgnoreCase);
        if (domain is not null && !ctx.AssistOffered && !wantsHuman)
        {
            ctx.AwaitingAssist = true;
            ctx.AssistOffered = true;
            return new AppointmentTurnResult(BuildAssistOffer(domain, ctx.UnitLabel, ar), true, new JsonArray(), ctx, "list_appointment_slots");
        }
        return await ListSlotsAsync(conn, ar, ctx, ct);
    }

    private async Task<AppointmentTurnResult> ListSlotsAsync(
        System.Data.Common.DbConnection conn, bool ar, AppointmentContext ctx, CancellationToken ct)
    {
        var rows = (await conn.QueryAsync(DbProc.Call("usp_ListAppointmentAvailability",
            new { limit = 40, unit = ctx.UnitCode, q = (string?)null }, ct))).ToList();
        if (rows.Count == 0)
        {
            var empty = ar
                ? $"لا توجد أوقات مفتوحة حالياً لدى {ctx.UnitLabel}. أخبرني بفترة أخرى وسأتحقق مجدداً."
                : $"There are no open times right now at {ctx.UnitLabel}. Give me another period and I will check again.";
            ctx.OfferedSlots = [];
            return new AppointmentTurnResult(empty, true, new JsonArray(), ctx, "list_appointment_slots");
        }

        var unitLocation = await UnitLocation(conn, ctx.UnitCode!, ar, ct);
        var advisor = await PickRoundRobinAdvisor(conn, ctx.UnitCode!, rows, ct);
        if (advisor is not null)
        {
            ctx.SelectedAdvisorId = advisor.Id.ToString();
            ctx.SelectedAdvisorName = advisor.Name;
        }
        ctx.UnitLocation = unitLocation;

        IEnumerable<dynamic> pool = rows;
        if (advisor is not null)
        {
            var forAdvisor = new List<dynamic>();
            foreach (var r in rows)
            {
                if ((object?)r.staff_id is Guid sid && sid == advisor.Id)
                    forAdvisor.Add(r);
            }
            if (forAdvisor.Count > 0) pool = forAdvisor;
        }

        var offered = pool.Take(5).Select(r =>
        {
            var s = MapSlot(r);
            if (string.IsNullOrWhiteSpace(s.StaffName) && advisor is not null) s.StaffName = advisor.Name;
            if (string.IsNullOrWhiteSpace(s.Location) && !string.IsNullOrWhiteSpace(unitLocation)) s.Location = unitLocation;
            return s;
        }).ToList();
        ctx.OfferedSlots = offered.Select(s => new OfferedSlotDto
        {
            SlotId = s.SlotId,
            Start = s.Start,
            End = s.End,
            StaffName = s.StaffName ?? advisor?.Name,
            Unit = s.UnitName,
            UnitCode = s.UnitCode,
            TypeName = s.TypeName,
            DurationMinutes = s.DurationMinutes,
            Location = s.Location ?? unitLocation,
        }).ToList();
        ctx.AwaitingAssist = false;
        ctx.AwaitingService = false;

        var lines = offered.Select((s, i) => FormatSlotLine(s, ar, i + 1));
        var head = new List<string>();
        if (advisor is not null || !string.IsNullOrWhiteSpace(unitLocation))
        {
            head.Add(ar ? $"اخترت لك الوحدة: {ctx.UnitLabel}." : $"Unit selected: {ctx.UnitLabel}.");
            if (advisor is not null)
                head.Add(ar ? $"- المستشار المسؤول: {advisor.Name}" : $"- Responsible advisor: {advisor.Name}");
            if (!string.IsNullOrWhiteSpace(unitLocation))
                head.Add(ar ? $"- المكان: {unitLocation}" : $"- Location: {unitLocation}");
            head.Add("");
        }
        var answer = string.Join("\n\n", new[]
        {
            string.Join("\n", head) + (ar ? "لقيت هالأوقات المتاحة:" : "I found these available times:"),
            string.Join("\n", lines),
            ar
                ? "قل لي رقم الخيار أو الوقت اللي تبيه، وأتحقق من التوفر مرة ثانية قبل الحجز."
                : "Reply with the option number or preferred time, and I'll re-check availability before booking.",
        });
        return new AppointmentTurnResult(answer, true, new JsonArray(), ctx, "list_appointment_slots");
    }

    private static async Task<string?> UnitLocation(
        System.Data.Common.DbConnection conn, string unitCode, bool ar, CancellationToken ct)
    {
        var row = await conn.QueryFirstOrDefaultAsync(DbProc.Call("usp_AppointmentChat_UnitLocation",
            new { unitCode }, ct));
        if (row is null) return null;
        string? en = row.En, ara = row.Ar;
        return ar ? (ara ?? en) : (en ?? ara);
    }

    private static async Task<AdvisorPick?> PickRoundRobinAdvisor(
        System.Data.Common.DbConnection conn, string unitCode, List<dynamic> rows, CancellationToken ct)
    {
        var advisors = new List<AdvisorPick>();
        foreach (var r in rows)
        {
            if ((object?)r.staff_id is not Guid staffId) continue;
            var name = DynStr(r.staff_name);
            if (string.IsNullOrWhiteSpace(name)) continue;
            if (advisors.Any(a => a.Id == staffId)) continue;
            advisors.Add(new AdvisorPick(staffId, name));
        }
        advisors = advisors.OrderBy(a => a.Name, StringComparer.OrdinalIgnoreCase).ToList();
        if (advisors.Count == 0) return null;
        if (advisors.Count == 1) return advisors[0];

        Guid? lastId = null;
        try
        {
            lastId = await conn.ExecuteScalarAsync<Guid?>(DbProc.Call("usp_AppointmentChat_LastAdvisor", new { unitCode }, ct));
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch { /* fall through to first advisor */ }

        if (lastId is null) return advisors[0];
        var idx = advisors.FindIndex(a => a.Id == lastId.Value);
        if (idx < 0) return advisors[0];
        return advisors[(idx + 1) % advisors.Count];
    }

    private sealed record AdvisorPick(Guid Id, string Name);

    private static async Task<List<ServiceOption>> ListBookableUnits(
        System.Data.Common.DbConnection conn, bool ar, CancellationToken ct)
    {
        var rows = (await conn.QueryAsync(DbProc.Call("usp_ListAppointmentAvailability",
            new { limit = 200, unit = (string?)null, q = (string?)null }, ct))).ToList();
        var map = new Dictionary<string, ServiceOption>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in rows)
        {
            var code = (string?)r.unit_code;
            var label = ar ? ((string?)r.unit_name_ar ?? (string?)r.unit_name_en) : ((string?)r.unit_name_en ?? (string?)r.unit_name_ar);
            if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(label)) continue;
            map.TryAdd(code, new ServiceOption { UnitCode = code, Label = label! });
        }
        // Also include appointment-enabled units with no current slots.
        var enabled = (await conn.QueryAsync(DbProc.Call("usp_Directory_ListUnits", null, ct))).ToList();
        // Directory list may not expose appointment_enabled — rely on slots for now.
        return map.Values.OrderBy(x => x.Label).ToList();
    }

    private static async Task<string?> UnitLabel(
        System.Data.Common.DbConnection conn, string code, bool ar, CancellationToken ct)
    {
        var rows = (await conn.QueryAsync(DbProc.Call("usp_ListAppointmentAvailability",
            new { limit = 1, unit = code, q = (string?)null }, ct))).ToList();
        if (rows.Count == 0) return null;
        var r = rows[0];
        return ar ? ((string?)r.unit_name_ar ?? (string?)r.unit_name_en) : ((string?)r.unit_name_en ?? (string?)r.unit_name_ar);
    }

    private static SlotInfo MapSlot(dynamic r)
    {
        var start = ToDto(r.start_time);
        var end = ToDto(r.end_time);
        return new SlotInfo
        {
            SlotId = ((Guid)r.id).ToString(),
            Start = start,
            End = end,
            StaffName = DynStr(r.staff_name),
            UnitName = DynStr(r.unit_name_en) ?? DynStr(r.unit_name_ar),
            UnitCode = DynStr(r.unit_code),
            TypeName = DynStr(r.type_name_en) ?? DynStr(r.type_name_ar),
            DurationMinutes = DynInt(r.duration_minutes),
            Location = DynStr(r.location),
        };
    }

    private static string? DynStr(object? value)
    {
        if (value is null or DBNull) return null;
        if (value is string s) return string.IsNullOrWhiteSpace(s) ? null : s;
        var text = Convert.ToString(value);
        return string.IsNullOrWhiteSpace(text) ? null : text;
    }

    private static int? DynInt(object? value)
    {
        if (value is null or DBNull) return null;
        try { return Convert.ToInt32(value); }
        catch { return null; }
    }

    private static string ToDto(object? value)
    {
        if (value is null or DBNull) return DateTimeOffset.UtcNow.ToString("o");
        if (value is DateTimeOffset dto) return dto.ToString("o");
        if (value is DateTime dt) return new DateTimeOffset(dt, TimeSpan.Zero).ToString("o");
        return value.ToString() ?? DateTimeOffset.UtcNow.ToString("o");
    }

    private static string FormatSlotLine(SlotInfo s, bool ar, int index)
    {
        var date = FormatDate(s.Start, ar);
        var time = FormatTime(s.Start, ar);
        var type = string.Join(" · ", new[] { s.TypeName, s.DurationMinutes is int m ? $"{m} {(ar ? "دقيقة" : "min")}" : null }.Where(x => !string.IsNullOrWhiteSpace(x)));
        var lines = new List<string> { $"**{index}.** {date} · {time}" };
        if (!string.IsNullOrWhiteSpace(s.StaffName)) lines.Add($"   {s.StaffName}");
        if (!string.IsNullOrWhiteSpace(type)) lines.Add($"   {type}");
        if (!string.IsNullOrWhiteSpace(s.Location)) lines.Add($"   {s.Location}");
        return string.Join("\n", lines);
    }

    private static string BuildBookingSummary(OfferedSlotDto s, bool ar)
    {
        var when = $"{FormatDate(s.Start, ar)}, {FormatTime(s.Start, ar)}";
        var duration = s.DurationMinutes is int m ? (ar ? $" ({m} دقيقة)" : $" ({m} minutes)") : "";
        var intro = ar
            ? $"جهّزت طلب موعدك ليوم {when}."
            : $"I have prepared your appointment request for {when}.";
        var facts = string.Join("\n", new[]
        {
            ar ? $"- الخدمة: {s.TypeName ?? "—"}" : $"- Service: {s.TypeName ?? "—"}",
            ar ? $"- المستشار: {s.StaffName ?? "—"}" : $"- Advisor: {s.StaffName ?? "—"}",
            ar ? $"- التاريخ والوقت: {when}{duration}" : $"- Date & time: {when}{duration}",
            ar ? $"- المكان: {s.Location ?? "—"}" : $"- Location: {s.Location ?? "—"}",
            ar ? $"- الوحدة: {s.Unit ?? "—"}" : $"- Unit: {s.Unit ?? "—"}",
        });
        var confirm = ar
            ? "يرجى التأكيد أدناه لمتابعة حجز هذا الموعد."
            : "Please confirm below to proceed with booking this appointment slot.";
        return string.Join("\n\n", new[]
        {
            intro,
            $"**{(ar ? "ملخص الحجز" : "Booking Summary")}**\n{facts}",
            confirm,
        });
    }

    private static JsonObject BookProposal(OfferedSlotDto s, bool ar) => new()
    {
        ["key"] = "book_appointment",
        ["toolName"] = "book_appointment",
        ["labelEn"] = "Book this appointment",
        ["labelAr"] = "حجز هذا الموعد",
        ["risk"] = "level_2",
        ["affectedService"] = "Appointments",
        ["dataShared"] = ar ? "اسمك ورقمك الجامعي والموعد المختار" : "Your name, student number and the chosen slot",
        ["expectedOutcome"] = ar ? "موعد مؤكد مع رمز تأكيد" : "A confirmed appointment with a confirmation code",
        ["consequence"] = ar
            ? "يُحجز المقعد باسمك وتستلم رمز تأكيد. يمكنك الإلغاء لاحقاً من سندي."
            : "The slot is reserved in your name and you receive a confirmation code. You can cancel later in Sanadi.",
        ["fee"] = ar ? "بدون رسوم" : "No fee",
        ["responsibleUnit"] = s.Unit ?? "Appointments",
        ["route"] = "/requests",
        ["args"] = new JsonObject { ["slotId"] = s.SlotId },
        ["humanApprovalRequired"] = false,
        ["reversible"] = "yes",
    };

    private static OfferedSlotDto? PickSlot(string text, List<OfferedSlotDto> offered)
    {
        var norm = text.Trim();
        if (int.TryParse(Regex.Match(norm, @"\b([1-9]\d?)\b").Groups[1].Value, out var n) && n >= 1 && n <= offered.Count)
            return offered[n - 1];

        var time = ParseTime(norm);
        var dayHint = Regex.IsMatch(norm, @"monday|الاثنين", RegexOptions.IgnoreCase) ? DayOfWeek.Monday
            : Regex.IsMatch(norm, @"tuesday|الثلاثاء", RegexOptions.IgnoreCase) ? DayOfWeek.Tuesday
            : Regex.IsMatch(norm, @"wednesday|الأربعاء", RegexOptions.IgnoreCase) ? DayOfWeek.Wednesday
            : Regex.IsMatch(norm, @"thursday|الخميس", RegexOptions.IgnoreCase) ? DayOfWeek.Thursday
            : Regex.IsMatch(norm, @"friday|الجمعة", RegexOptions.IgnoreCase) ? DayOfWeek.Friday
            : Regex.IsMatch(norm, @"saturday|السبت", RegexOptions.IgnoreCase) ? DayOfWeek.Saturday
            : Regex.IsMatch(norm, @"sunday|الأحد", RegexOptions.IgnoreCase) ? DayOfWeek.Sunday
            : (DayOfWeek?)null;

        var matches = offered.Where(s =>
        {
            if (!DateTimeOffset.TryParse(s.Start, out var start)) return false;
            var dubai = start.ToOffset(TimeSpan.FromHours(4));
            if (dayHint is DayOfWeek d && dubai.DayOfWeek != d) return false;
            if (time is null) return dayHint is not null;
            return dubai.Hour == time.Value.Hour && (time.Value.Minute == 0 || dubai.Minute == time.Value.Minute);
        }).ToList();
        return matches.Count == 1 ? matches[0] : null;
    }

    private static (int Hour, int Minute)? ParseTime(string text)
    {
        var ampm = Regex.Match(text, @"(\d{1,2})(?::(\d{2}))?\s*(am|pm)", RegexOptions.IgnoreCase);
        if (ampm.Success)
        {
            var h = int.Parse(ampm.Groups[1].Value);
            var m = ampm.Groups[2].Success ? int.Parse(ampm.Groups[2].Value) : 0;
            var pm = ampm.Groups[3].Value.StartsWith("p", StringComparison.OrdinalIgnoreCase);
            if (pm && h < 12) h += 12;
            if (!pm && h == 12) h = 0;
            return (h, m);
        }
        var h24 = Regex.Match(text, @"\b([01]?\d|2[0-3]):([0-5]\d)\b");
        if (h24.Success) return (int.Parse(h24.Groups[1].Value), int.Parse(h24.Groups[2].Value));
        return null;
    }

    private static ServiceOption? MatchService(string text, List<ServiceOption> options)
    {
        var byHint = DetectUnitCode(text);
        if (byHint is not null)
        {
            var hit = options.FirstOrDefault(o => string.Equals(o.UnitCode, byHint, StringComparison.OrdinalIgnoreCase));
            if (hit is not null) return hit;
        }
        if (int.TryParse(Regex.Match(text, @"\b([1-9]\d?)\b").Groups[1].Value, out var n) && n >= 1 && n <= options.Count)
            return options[n - 1];
        var words = Regex.Split(text.ToLowerInvariant(), @"[^\p{L}\p{N}]+").Where(w => w.Length >= 3).ToHashSet();
        if (words.Count == 0) return null;
        var scored = options.Select(o =>
        {
            var hay = Regex.Split(o.Label.ToLowerInvariant(), @"[^\p{L}\p{N}]+").Where(w => w.Length >= 3).ToHashSet();
            return (o, score: words.Count(hay.Contains));
        }).Where(x => x.score > 0).OrderByDescending(x => x.score).ToList();
        return scored.Count == 1 || (scored.Count > 1 && scored[0].score > scored[1].score) ? scored[0].o : null;
    }

    private static string? DetectUnitCode(string text)
    {
        foreach (var (re, code) in UnitHints)
            if (re.IsMatch(text)) return code;
        return null;
    }

    private static bool IsHumanPreference(string text) => HumanRe.IsMatch(text);

    private static string? AssistDomain(string? unitCode) => unitCode?.ToUpperInvariant() switch
    {
        "CAREER" => "career",
        "ADV" or "ADVISING" => "advising",
        "LIB" => "library",
        "REG" or "ADM" or "ADMREG" => "registration",
        _ => null,
    };

    private static string BuildAssistOffer(string domain, string? unitLabel, bool ar)
    {
        var caps = domain switch
        {
            "career" => ar
                ? new[] { "مراجعة سيرتك الذاتية المحفوظة", "حساب درجة توافق سيرتك مع أنظمة التوظيف (ATS)", "اقتراح وظائف تناسب تخصصك وملفك", "تحديد الفجوات في مهاراتك وما ينبغي تعلّمه", "اقتراح مسارات مهنية", "تجهيزك لمقابلات العمل" }
                : new[] { "review your saved CV", "calculate your ATS score", "find suitable roles for your degree and profile", "identify your skill gaps and what to learn next", "suggest career pathways", "help you prepare for interviews" },
            "advising" => ar
                ? new[] { "عرض تقدّمك الأكاديمي", "بيان المتطلبات المتبقية", "التحقق من جاهزيتك للتسجيل", "التحقق من جاهزيتك للتخرج" }
                : new[] { "show your academic progress", "list your remaining requirements", "check your registration readiness", "check your graduation readiness" },
            "library" => ar
                ? new[] { "البحث في فهرس المكتبة", "معرفة ساعات عمل المكتبة", "شرح الإعارة والتجديد" }
                : new[] { "search the library catalogue", "check library opening hours", "explain borrowing and renewals" },
            _ => ar
                ? new[] { "التحقق من جاهزيتك للتسجيل", "التحقق من أي قيود فعّالة على سجلك" }
                : new[] { "check your registration readiness", "check any active holds on your record" },
        };
        var name = unitLabel ?? (ar ? "الوحدة" : "the unit");
        return string.Join("\n\n", new[]
        {
            ar ? "بكل تأكيد. قبل أن أحجز الموعد، قد أتمكّن من مساعدتك هنا مباشرة." : "Absolutely. Before I book that, I may be able to help you right here.",
            ar ? "يمكنني:" : "I can:",
            string.Join("\n", caps.Select(c => $"- {c}")),
            ar ? $"هل تحب أن أساعدك بأحدها الآن، أم تفضّل حجز موعد مع {name}؟" : $"Would you like me to help with any of these first, or would you still prefer to book a {name} appointment?",
        });
    }

    private static string FormatDate(string iso, bool ar)
    {
        if (!DateTimeOffset.TryParse(iso, out var dto)) return iso;
        return dto.ToOffset(TimeSpan.FromHours(4)).ToString("dddd d MMMM", ar ? new CultureInfo("ar-AE") : new CultureInfo("en-GB"));
    }

    private static string FormatTime(string iso, bool ar)
    {
        if (!DateTimeOffset.TryParse(iso, out var dto)) return iso;
        var t = dto.ToOffset(TimeSpan.FromHours(4)).ToString("h:mm tt", ar ? new CultureInfo("ar-AE") : CultureInfo.InvariantCulture);
        return ar ? t : t.Replace("AM", "AM").Replace("PM", "PM");
    }

    public static AppointmentContext? ParseContext(JsonNode? metadata)
    {
        try
        {
            var node = metadata?["appointmentContext"];
            if (node is null) return null;
            return JsonSerializer.Deserialize<AppointmentContext>(node.ToJsonString(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        }
        catch { return null; }
    }

    public sealed class AppointmentTurnResult(string Answer, bool Verified, JsonArray ProposedActions, AppointmentContext Context, string ToolUsed)
    {
        public string Answer { get; } = Answer;
        public bool Verified { get; } = Verified;
        public JsonArray ProposedActions { get; } = ProposedActions;
        public AppointmentContext Context { get; } = Context;
        public string ToolUsed { get; } = ToolUsed;
    }

    public sealed class AppointmentContext
    {
        public string? UnitCode { get; set; }
        public string? UnitLabel { get; set; }
        public string? UnitLocation { get; set; }
        public string? SelectedAdvisorId { get; set; }
        public string? SelectedAdvisorName { get; set; }
        public bool AwaitingService { get; set; }
        public bool AwaitingAssist { get; set; }
        public bool AssistOffered { get; set; }
        public List<ServiceOption>? ServiceOptions { get; set; }
        public List<OfferedSlotDto>? OfferedSlots { get; set; }
    }

    public sealed class ServiceOption
    {
        public string? UnitCode { get; set; }
        public string Label { get; set; } = "";
    }

    public sealed class OfferedSlotDto
    {
        public string SlotId { get; set; } = "";
        public string Start { get; set; } = "";
        public string End { get; set; } = "";
        public string? StaffName { get; set; }
        public string? Unit { get; set; }
        public string? UnitCode { get; set; }
        public string? TypeName { get; set; }
        public int? DurationMinutes { get; set; }
        public string? Location { get; set; }
    }

    private sealed class SlotInfo
    {
        public string SlotId { get; set; } = "";
        public string Start { get; set; } = "";
        public string End { get; set; } = "";
        public string? StaffName { get; set; }
        public string? UnitName { get; set; }
        public string? UnitCode { get; set; }
        public string? TypeName { get; set; }
        public int? DurationMinutes { get; set; }
        public string? Location { get; set; }
    }
}
