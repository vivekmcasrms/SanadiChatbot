using System.Text.Json.Nodes;
using Sanadi.Domain.Security;

namespace Sanadi.Infrastructure.AppFunctions;

/// <summary>Caller-scoped C# implementation of the academic-record server function.</summary>
public sealed class AcademicFunctions(FunctionData db)
{
    public async Task<object> Briefing(string lang, ICurrentUser user, CancellationToken ct)
    {
        var uid=FunctionData.RequireUser(user).ToString(); var ar=lang=="ar";
        await GenerateAlerts(uid,user,ct);
        var profile=await db.One("student_profiles","completed_credit_hours,cumulative_gpa,program_id",user,ct,[FunctionData.Eq("user_id",uid)]);
        if(profile is null) return new { hasProfile=false,headline=ar?"لم أجد سجلاً أكاديمياً مرتبطاً بحسابك بعد، لكن يمكنني الإجابة عن أسئلة الجامعة وفتح الطلبات.":"I could not find an academic record linked to your account yet, but I can still answer university questions and open requests.",facts=Array.Empty<object>() };
        var programId=profile.S("program_id"); var program=programId is null?null:await db.One("academic_programs","total_credit_hours",user,ct,[FunctionData.Eq("id",programId)]);
        var holds=await db.Rows("student_holds","id,prevents_registration",user,ct,[FunctionData.Eq("student_id",uid),FunctionData.Eq("status","active")]);
        var cases=await db.Rows("cases","id",user,ct,[FunctionData.Eq("student_id",uid),FunctionData.Filter("status","not.in","(resolved,closed)")]);
        var alerts=await db.Rows("student_alerts","id",user,ct,[FunctionData.Eq("student_id",uid),FunctionData.Eq("is_read",false),FunctionData.Eq("status","active")]);
        var completed=(int)profile.N("completed_credit_hours"); var total=(int)(program?.N("total_credit_hours",120)??120); var blocking=holds.Count(x=>x.B("prevents_registration"));
        var facts=new[]{new{label=ar?"الساعات المكتملة":"Completed credit hours",value=$"{completed} / {total}"},new{label=ar?"التقدم نحو التخرج":"Graduation progress",value=$"{Math.Round(completed*100d/Math.Max(1,total))}%"},new{label=ar?"المعدل التراكمي":"GPA",value=profile["cumulative_gpa"]?.ToString()??"—"},new{label=ar?"الإيقافات النشطة":"Active holds",value=holds.Length.ToString()},new{label=ar?"الطلبات المفتوحة":"Open requests",value=cases.Length.ToString()},new{label=ar?"تنبيهات غير مقروءة":"Unread alerts",value=alerts.Length.ToString()}};
        var headline=blocking>0?(ar?$"يوجد {blocking} عائق يمنع تسجيلك — يمكنني معالجته الآن.":$"{blocking} blocker{(blocking==1?" is":"s are")} stopping your registration — I can handle it now."):(ar?"سجلك سليم اليوم — لا توجد عوائق نشطة.":"Your record is clear today — nothing is blocking you.");
        return new { hasProfile=true,headline,facts };
    }

    private async Task GenerateAlerts(string uid, ICurrentUser user, CancellationToken ct)
    {
        var existing=(await db.Rows("student_alerts","alert_type",user,ct,[FunctionData.Eq("student_id",uid),FunctionData.Eq("status","active")])).Select(x=>x.S("alert_type")).ToHashSet();
        var waiting=await db.Rows("cases","id,case_number,title,status",user,ct,[FunctionData.Eq("student_id",uid),FunctionData.In("status",["awaiting_student","student_confirmation","resolution_proposed"])],limit:5);
        foreach(var c in waiting){var type=$"case_waiting_{c.S("status")}";if(existing.Contains(type))continue;await db.Write("student_alerts","POST",new{student_id=uid,alert_type=type,severity="high",title_en=c.S("status")=="resolution_proposed"?"A resolution is waiting for your answer":"Your request is waiting for you",title_ar=c.S("status")=="resolution_proposed"?"هناك حل بانتظار ردك":"طلبك بانتظار ردك",body_en=$"{c.S("case_number")} — {c.S("title")}. The unit cannot move forward until you reply.",body_ar=$"{c.S("case_number")} — {c.S("title")}. لا يمكن للجهة المختصة المتابعة حتى ترد.",action_label_en="Open the request",action_label_ar="فتح الطلب",action_url=$"/requests/{c.S("id")}",related_case_id=c.S("id"),status="active"},user,ct);existing.Add(type);}
        var requirements=await db.Rows("student_requirements","title_en,title_ar,due_date,status",user,ct,[FunctionData.Eq("student_id",uid),FunctionData.Filter("status","neq","completed")],limit:10);
        if(!existing.Contains("requirement_due_soon")) foreach(var r in requirements){if(!DateTimeOffset.TryParse(r.S("due_date"),out var due))continue;var days=(int)Math.Round((due-DateTimeOffset.UtcNow).TotalDays);if(days<0||days>14)continue;await db.Write("student_alerts","POST",new{student_id=uid,alert_type="requirement_due_soon",severity=days<=3?"critical":"high",title_en=$"Requirement due in {days} day{(days==1?"":"s")}",title_ar=$"متطلب مستحق خلال {days} يوم",body_en=$"{r.S("title_en")} is due on {r.S("due_date")}. Leaving it can block your registration.",body_ar=$"{r.S("title_ar")} مستحق بتاريخ {r.S("due_date")}. تأخيره قد يمنع تسجيلك.",action_label_en="Ask Sanadi to help",action_label_ar="اطلب مساعدة سندي",action_url="/assistant",deadline=due,status="active"},user,ct);break;}
        var holds=await db.Rows("student_holds","title_en,title_ar,resolution_action_en,resolution_action_ar,prevents_registration",user,ct,[FunctionData.Eq("student_id",uid),FunctionData.Eq("status","active")]);
        if(!existing.Contains("registration_hold_active"))foreach(var h in holds.Where(x=>x.B("prevents_registration")).Take(1)){await db.Write("student_alerts","POST",new{student_id=uid,alert_type="registration_hold_active",severity="critical",title_en="A hold is blocking your registration",title_ar="يوجد إيقاف يمنع تسجيلك",body_en=$"{h.S("title_en")}. {h.S("resolution_action_en")??"I can open one tracked request to clear it."}",body_ar=$"{h.S("title_ar")}. {h.S("resolution_action_ar")??"يمكنني فتح طلب واحد متابع لرفعه."}",action_label_en="Clear it with Sanadi",action_label_ar="رفع الإيقاف مع سندي",action_url="/assistant?ask=What%20is%20stopping%20me%20from%20registering%3F",status="active"},user,ct);}
    }

    public async Task<object> Mine(ICurrentUser user, CancellationToken ct)
    {
        var userId = FunctionData.RequireUser(user).ToString();
        var profile = await db.One("student_profiles", "student_number,program_id,college_id,current_academic_term_id,account_status,completed_credit_hours,registered_credit_hours,cumulative_gpa,academic_standing,academic_level,expected_graduation_date", user, ct, [FunctionData.Eq("user_id", userId)]);
        var account = await db.One("profiles", "full_name", user, ct, [FunctionData.Eq("id", userId)]);
        var programId = profile.S("program_id");
        var program = programId is null ? null : await db.One("academic_programs", "code,name_en,name_ar,total_credit_hours,internship_minimum_credits", user, ct, [FunctionData.Eq("id", programId)]);
        var collegeId = profile.S("college_id");
        var college = collegeId is null ? null : await db.One("colleges", "name_en,name_ar", user, ct, [FunctionData.Eq("id", collegeId)]);
        var termId = profile.S("current_academic_term_id");
        var term = termId is null ? null : await db.One("academic_terms", "name_en,name_ar", user, ct, [FunctionData.Eq("id", termId)]);
        var holds = await db.Rows("student_holds", "title_en,title_ar,description_en,description_ar,resolution_action_en,resolution_action_ar,prevents_registration,prevents_graduation", user, ct, [FunctionData.Eq("student_id", userId), FunctionData.Eq("status", "active")]);
        var requirements = await db.Rows("student_requirements", "title_en,title_ar,status,due_date", user, ct, [FunctionData.Eq("student_id", userId), FunctionData.Filter("status", "neq", "completed")], [FunctionData.Order("due_date")]);
        var cases = await db.Rows("cases", "id", user, ct, [FunctionData.Eq("student_id", userId), FunctionData.Filter("status", "not.in", "(resolved,closed)")]);
        var alerts = await db.Rows("student_alerts", "id", user, ct, [FunctionData.Eq("student_id", userId), FunctionData.Eq("is_read", false), FunctionData.Eq("status", "active")]);
        var total = (int)(program?.N("total_credit_hours", 120) ?? 120);
        var completedCredits = (int)(profile?.N("completed_credit_hours") ?? 0);
        var snapshot = new
        {
            hasProfile = profile is not null, fullName = account.S("full_name"), studentNumber = profile.S("student_number"), programId,
            programCode = program.S("code"), programNameEn = program.S("name_en"), programNameAr = program.S("name_ar"),
            collegeNameEn = college.S("name_en"), collegeNameAr = college.S("name_ar"), currentTermEn = term.S("name_en"), currentTermAr = term.S("name_ar"),
            enrollmentStatus = profile.S("account_status"), totalCredits = total, internshipMinimum = Num(program, "internship_minimum_credits"),
            completedCredits, remainingCredits = Math.Max(0, total - completedCredits), registeredCredits = (int)(profile?.N("registered_credit_hours") ?? 0),
            gpa = Num(profile, "cumulative_gpa"), standing = profile.S("academic_standing"), level = profile.S("academic_level"), expectedGraduation = profile.S("expected_graduation_date"),
            holds = holds.Select(h => new { titleEn = h.S("title_en") ?? "", titleAr = h.S("title_ar") ?? "", descriptionEn = h.S("description_en"), descriptionAr = h.S("description_ar"), resolutionEn = h.S("resolution_action_en"), resolutionAr = h.S("resolution_action_ar"), blocksRegistration = h.B("prevents_registration"), blocksGraduation = h.B("prevents_graduation") }),
            requirements = requirements.Select(r => new { titleEn = r.S("title_en") ?? "", titleAr = r.S("title_ar") ?? "", status = r.S("status") ?? "", dueDate = r.S("due_date") }),
            openCases = cases.Length, unreadAlerts = alerts.Length
        };
        return new { snapshot, courses = await Courses(user, userId, programId, ct) };
    }

    private async Task<object> Courses(ICurrentUser user, string userId, string? programId, CancellationToken ct)
    {
        var history = await db.Rows("student_course_history", "course_id,grade,credits_earned,completion_status", user, ct, [FunctionData.Eq("student_id", userId)]);
        var enrolments = await db.Rows("student_current_enrollments", "course_section_id,enrollment_status", user, ct, [FunctionData.Eq("student_id", userId)]);
        JsonObject[] plan = programId is null ? [] : await db.Rows("program_courses", "course_id,requirement_type,recommended_year,is_required", user, ct, [FunctionData.Eq("program_id", programId)]);
        JsonObject[] basketRows = programId is null ? [] : await db.Rows("program_requirement_baskets", "id,code,name_en,name_ar,basket_type,effective_catalog_year,required_credit_hours,required_course_count,course_list_verified,selection_note_en,selection_note_ar,display_order", user, ct, [FunctionData.Eq("program_id", programId)], [FunctionData.Order("display_order")]);
        var basketIds = basketRows.Select(x => x.S("id")).Where(x => x is not null).Cast<string>().ToArray();
        JsonObject[] basketLinks = basketIds.Length == 0 ? [] : await db.Rows("program_basket_courses", "basket_id,course_id", user, ct, [FunctionData.In("basket_id", basketIds)]);
        var sectionIds = enrolments.Select(x => x.S("course_section_id")).Where(x => x is not null).Cast<string>().ToArray();
        JsonObject[] sections = sectionIds.Length == 0 ? [] : await db.Rows("course_sections", "id,course_id", user, ct, [FunctionData.In("id", sectionIds)]);
        var courseIds = history.Concat(plan).Concat(basketLinks).Select(x => x.S("course_id")).Concat(sections.Select(x => x.S("course_id"))).Where(x => x is not null).Cast<string>().Distinct().ToArray();
        JsonObject[] rows = courseIds.Length == 0 ? [] : await db.Rows("courses", "id,code,title_en,title_ar,credit_hours", user, ct, [FunctionData.In("id", courseIds)]);
        var courses = rows.ToDictionary(x => x.S("id")!, x => x);
        object Entry(JsonObject c, JsonObject? source = null, string? requirement = null, int? year = null) => new { code = c.S("code") ?? "", titleEn = c.S("title_en") ?? "", titleAr = c.S("title_ar") ?? c.S("title_en") ?? "", creditHours = source?["credits_earned"] is null ? c.N("credit_hours", 3) : source.N("credits_earned"), grade = source.S("grade"), termEn = (string?)null, termAr = (string?)null, requirementType = requirement, recommendedYear = year };
        var completedRows = history.Where(h => h.S("completion_status") is null or "completed" && h.S("course_id") is { } id && courses.ContainsKey(id)).ToArray();
        var completedIds = completedRows.Select(h => h.S("course_id")!).ToHashSet();
        var completed = completedRows.Select(h => Entry(courses[h.S("course_id")!], h)).ToArray();
        var currentIds = new HashSet<string>(); var current = new List<object>();
        foreach (var e in enrolments.Where(x => x.S("enrollment_status") is not ("dropped" or "withdrawn"))) { var s = sections.FirstOrDefault(x => x.S("id") == e.S("course_section_id")); var id = s.S("course_id"); if (id is null || !courses.TryGetValue(id, out var c)) continue; currentIds.Add(id); current.Add(Entry(c)); }
        var fixedPlan = plan.Where(p => p["is_required"]?.ToJsonString() != "false").ToArray();
        var remainingRows = fixedPlan.Where(p => p.S("course_id") is { } id && !completedIds.Contains(id) && !currentIds.Contains(id) && courses.ContainsKey(id)).ToArray();
        var remaining = remainingRows.Select(p => Entry(courses[p.S("course_id")!], null, p.S("requirement_type"), p["recommended_year"] is null ? null : (int?)p.N("recommended_year"))).ToArray();
        var fixedIds = fixedPlan.Select(p => p.S("course_id")).Where(x => x is not null).Cast<string>().ToHashSet();
        var baskets = basketRows.Select(b =>
        {
            var eligibleIds = basketLinks.Where(l => l.S("basket_id") == b.S("id")).Select(l => l.S("course_id")).Where(id => id is not null && courses.ContainsKey(id)).Cast<string>().ToArray();
            var eligible = eligibleIds.Select(id => Entry(courses[id])).ToArray();
            var doneIds = eligibleIds.Where(id => !fixedIds.Contains(id) && completedIds.Contains(id)).ToArray();
            var selectedIds = eligibleIds.Where(id => !fixedIds.Contains(id) && !completedIds.Contains(id) && currentIds.Contains(id)).ToArray();
            var requiredHours = b.N("required_credit_hours");
            var completedBasketHours = Math.Min(requiredHours, doneIds.Sum(id => courses[id].N("credit_hours", 3)));
            var selectedHours = Math.Min(Math.Max(0, requiredHours - completedBasketHours), selectedIds.Sum(id => courses[id].N("credit_hours", 3)));
            var remainingBasketHours = Math.Max(0, requiredHours - completedBasketHours - selectedHours);
            var requiredCount = (int)b.N("required_course_count");
            var usedCount = Math.Min(requiredCount, doneIds.Length + selectedIds.Length);
            return new { basketId = b.S("id") ?? "", code = b.S("code") ?? "", nameEn = b.S("name_en") ?? "", nameAr = b.S("name_ar") ?? "", basketType = b.S("basket_type") ?? "", effectiveCatalogYear = b.S("effective_catalog_year") ?? "", requiredCreditHours = requiredHours, requiredCourseCount = requiredCount, eligibleCourses = eligible, completedCourses = doneIds.Select(id => Entry(courses[id], null, b.S("code"))).ToArray(), selectedCourses = selectedIds.Select(id => Entry(courses[id], null, b.S("code"))).ToArray(), completedCreditHours = completedBasketHours, selectedCreditHours = selectedHours, remainingCreditHours = remainingBasketHours, remainingCourseCount = remainingBasketHours == 0 ? 0 : Math.Max(0, requiredCount - usedCount), satisfied = remainingBasketHours == 0, courseListVerified = b.B("course_list_verified"), noteEn = b.S("selection_note_en"), noteAr = b.S("selection_note_ar") };
        }).ToArray();
        var completedHours = completedRows.Sum(h => h["credits_earned"] is null ? courses[h.S("course_id")!].N("credit_hours", 3) : h.N("credits_earned"));
        var currentHours = currentIds.Sum(id => courses[id].N("credit_hours", 3));
        var remainingHours = remainingRows.Sum(p => courses[p.S("course_id")!].N("credit_hours", 3));
        var basketRemaining = baskets.Sum(b => b.remainingCreditHours);
        return new { completed, current = current.ToArray(), remaining, baskets, completedCreditHours = completedHours, currentCreditHours = currentHours, fixedRemainingCreditHours = remainingHours, basketRemainingCreditHours = basketRemaining, remainingCreditHours = remainingHours + basketRemaining, programCourseCount = fixedPlan.Length + baskets.Length };
    }

    private static double? Num(JsonObject? row, string key) => row?[key] is null ? null : row.N(key);
}
