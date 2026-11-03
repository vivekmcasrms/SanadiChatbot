using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Dapper;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Notifications;
using Sanadi.Api.Routing;
using Sanadi.Api.Security;
using Sanadi.Application.Storage;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Career;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

/// <summary>Career profile, CV lifecycle, deterministic matching, and counselling intake.</summary>
[ApiController, Route("api/career")]
public sealed class CareerController(ISqlConnectionFactory sql, IObjectStorage storage) : ControllerBase
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly HashSet<string> AllowedMime = new(StringComparer.OrdinalIgnoreCase)
    {
        "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword", "text/plain"
    };
    private static readonly string[] OpenStatuses = ["draft","submitted","acknowledged","assigned","classified","routed","in_review","in_progress","awaiting_student","student_confirmation","resolution_proposed","escalated","on_hold","ai_processing","transferred","reopened"];

    private Guid UserId()
    {
        var user = HttpContext.GetSanadiUser();
        if (!user.IsAuthenticated || user.UserId is not Guid id) throw new UnauthorizedException();
        return id;
    }

    public sealed record UploadRequest(string FileName, string MimeType, string Content);
    public sealed record PreferencesRequest(string[]? PreferredRoles, string[]? PreferredFields, string[]? PreferredSectors, string[]? PreferredLocations, string? WorkMode, string? WorkOrientation);
    public sealed record AnalyseRequest(string? TargetRoleCode);
    public sealed record IdRequest(Guid CvId);
    public sealed record CounsellingRequest(string? Note, string? Lang);

    [HttpGet("state")]
    public async Task<object> State(CancellationToken ct)
    {
        var id = UserId();
        return new { analysis = await Analyse(id, null, false, ct), preferences = await Preferences(id) };
    }

    [HttpPost("analyse")]
    public async Task<object> AnalyseNow([FromBody] AnalyseRequest? request, CancellationToken ct) =>
        await Analyse(UserId(), request?.TargetRoleCode, true, ct);

    [HttpGet("roles")]
    public async Task<object> Roles(CancellationToken ct)
    {
        UserId(); await using var db = sql.Create();
        return await db.QueryAsync(DbProc.Call("usp_Career_ListRoles", null, ct));
    }

    [HttpPost("preferences")]
    public async Task<object> SavePreferences([FromBody] PreferencesRequest request, CancellationToken ct)
    {
        var id = UserId();
        static string Pack(string[]? values, int max) => JsonSerializer.Serialize((values ?? []).Take(max).Select(x => x[..Math.Min(x.Length, 120)]));
        var mode = request.WorkMode is "onsite" or "hybrid" or "remote" or "any" ? request.WorkMode : "any";
        var orientation = request.WorkOrientation is "industry" or "research" or "government" or "entrepreneurship" or "undecided" ? request.WorkOrientation : "undecided";
        await using var db = sql.Create();
        await db.ExecuteAsync(DbProc.Call("usp_Career_MergePreferences", new { id, roles=Pack(request.PreferredRoles,10), fields=Pack(request.PreferredFields,10), sectors=Pack(request.PreferredSectors,10), locations=Pack(request.PreferredLocations,10), mode, orientation }, ct));
        return await Analyse(id, null, true, ct);
    }

    [HttpPost("cv")]
    public async Task<object> Upload([FromBody] UploadRequest request, CancellationToken ct)
    {
        var id = UserId();
        if (!AllowedMime.Contains(request.MimeType)) throw new SanadiException("Please upload the CV as a PDF, Word document or plain text file.");
        byte[] bytes; try { bytes = Convert.FromBase64String(request.Content); } catch { throw new SanadiException("The CV content is invalid."); }
        if (bytes.Length == 0 || bytes.Length > 5 * 1024 * 1024) throw new SanadiException("The CV must be smaller than 5 MB.");
        var name = Regex.Replace(Path.GetFileName(request.FileName), @"[^\w.\-]+", "_");
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var findings = Scan(bytes, request.MimeType, request.FileName);
        var hasMalicious = findings.Any(x => x.severity == "malicious");
        var hasSuspicious = findings.Any(x => x.severity == "suspicious");
        var scanStatus = hasMalicious ? "rejected" : hasSuspicious ? "quarantined" : "clean";
        var verdict = findings.FirstOrDefault(x => x.severity == (hasMalicious ? "malicious" : "suspicious")).detail
                      ?? "No malicious or active content detected.";
        await using var db = sql.Create();
        if (scanStatus != "clean")
        {
            string? quarantine = null;
            if (scanStatus == "quarantined")
            {
                quarantine = $"quarantine/{id:D}/{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{name}";
                await using var q = new MemoryStream(bytes); await storage.UploadAsync("student-cvs", quarantine, q, "application/octet-stream", id, false, ct);
            }
            await db.ExecuteAsync(DbProc.Call("usp_Career_InsertUploadScan", new{id,file=request.FileName,mime=request.MimeType,size=bytes.Length,hash,status=scanStatus,verdict,json=JsonSerializer.Serialize(findings),quarantine}, ct));
            await Event(db,id,null,scanStatus=="rejected"?"cv_upload_rejected":"cv_upload_quarantined",new{verdict,findings,sha256=hash});
            throw new SanadiException(scanStatus == "rejected" ? "This file was blocked by our security checks. Please upload a plain PDF or Word CV with no embedded or executable content." : "This file was quarantined for a safety review because it contains active content. Please re-save it as a simple PDF and upload it again.");
        }

        var existing = await db.QuerySingleOrDefaultAsync<(Guid Id,string ParsingStatus,bool IsCurrent)>(DbProc.Call("usp_Career_FindCvByHash",new{id,hash}, ct));
        if (existing.Id != Guid.Empty && existing.ParsingStatus == "parsed")
        {
            if(!existing.IsCurrent) await db.ExecuteAsync(DbProc.Call("usp_Career_SetCurrentCv",new{id,cv=existing.Id}, ct));
            return new { cvId=existing.Id, parsingStatus=existing.ParsingStatus, parsingError=(string?)null, discrepancies=Array.Empty<string>(), analysis=await Analyse(id,null,true,ct) };
        }

        var path = $"{id:D}/{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{name}";
        await using (var stream = new MemoryStream(bytes)) await storage.UploadAsync("student-cvs", path, stream, request.MimeType, id, false, ct);
        var text = Extract(bytes, request.MimeType);
        var injection = InjectionFlags(text);
        var safeText = Sanitise(text);
        var status = safeText.Length >= 60 ? "parsed" : "failed";
        var error = status == "failed" ? "No readable text could be extracted. Please upload a text-based PDF or Word CV, not a scan." : null;
        var profile = ParseProfile(safeText);
        var cvId = Guid.NewGuid();
        await db.ExecuteAsync(DbProc.Call("usp_Career_InsertCvDocument",new{cvId,id,file=request.FileName,mime=request.MimeType,size=bytes.Length,path,text=safeText,profile=JsonSerializer.Serialize(profile),language=DetectLanguage(safeText),status,error,flags=JsonSerializer.Serialize(injection),hash}, ct));
        await db.ExecuteAsync(DbProc.Call("usp_Career_InsertCleanScan",new{id,cvId,file=request.FileName,mime=request.MimeType,size=bytes.Length,hash,verdict}, ct));
        await Event(db,id,cvId,"cv_uploaded",new{status,language=DetectLanguage(safeText),injectionFlags=injection.Length});
        return new { cvId, parsingStatus=status, parsingError=error, discrepancies=Array.Empty<string>(), analysis=await Analyse(id,null,true,ct) };
    }

    [HttpPost("cv/download")]
    public async Task<object> Download([FromBody] IdRequest request, CancellationToken ct)
    {
        var id=UserId(); await using var db=sql.Create();
        var path=await db.ExecuteScalarAsync<string?>(DbProc.Call("usp_Career_GetCvPath",new{request.CvId,id}, ct)) ?? throw new NotFoundException("CV not found.");
        return new { url=await storage.CreateSignedUrlAsync("student-cvs",path,300,HttpContext.GetSanadiUser(),ct) };
    }

    [HttpDelete("cv")]
    public async Task<object> Delete(CancellationToken ct)
    {
        var id=UserId(); await using var db=sql.Create();
        var cvs=(await db.QueryAsync<(Guid Id,string Path,bool Current)>(DbProc.Call("usp_Career_ListStudentCvs",new{id}, ct))).ToArray();
        var current=cvs.FirstOrDefault(x=>x.Current); if(current.Id==Guid.Empty)throw new NotFoundException("No CV to delete.");
        await storage.DeleteAsync("student-cvs",cvs.Select(x=>x.Path).Where(x=>!string.IsNullOrWhiteSpace(x)).ToArray(),HttpContext.GetSanadiUser(),ct);
        await db.ExecuteAsync(DbProc.Call("usp_Career_DeleteCvCascade",new{id}, ct));
        await Event(db,id,current.Id,"cv_deleted",new{cvId=current.Id});
        return new { ok=true, analysis=await Analyse(id,null,true,ct) };
    }

    [HttpGet("counselling")]
    public async Task<object?> Counselling(CancellationToken ct)
        => await FindOpenCounselling(sql, UserId(), ct);

    internal static async Task<object?> FindOpenCounselling(ISqlConnectionFactory sql, Guid id, CancellationToken ct)
    {
        await using var db=sql.Create();
        var openJson=JsonSerializer.Serialize(OpenStatuses);
        var row=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Career_GetOpenCounselling",new{id,openJson}, ct));
        return row;
    }

    [HttpPost("counselling")]
    public async Task<object> RequestCounselling([FromBody] CounsellingRequest request, CancellationToken ct)
    {
        var id=UserId(); await using var db=sql.Create();
        var openJson=JsonSerializer.Serialize(OpenStatuses);
        var existing=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Career_GetOpenCounselling",new{id,openJson}, ct));
        if(existing is not null)return new{created=false,request=existing,acknowledgement=$"You already have an open counselling request ({(string)existing.reference})."};
        var unit=await db.QuerySingleOrDefaultAsync<(Guid Id,Guid? Owner)>(DbProc.Call("usp_Career_GetCareerUnit", null, ct));
        var assignment=await TicketAssignment.ResolveAsync(db,unit.Id,id,ct:ct);
        var caseId=Guid.NewGuid(); var reference=$"CAR-{DateTime.UtcNow:yyyyMMdd}-{Random.Shared.Next(1000,9999)}"; var now=DateTimeOffset.UtcNow;
        var description="The student has asked to meet a human career counsellor to discuss their career direction.\n"+(string.IsNullOrWhiteSpace(request.Note)?"Student did not add a specific reason.":$"Student's reason: {request.Note.Trim()[..Math.Min(request.Note.Trim().Length,1000)]}");
        await db.ExecuteAsync(DbProc.Call("usp_Career_CreateCounsellingCase",new{caseId,reference,id,unit=assignment.UnitId,owner=assignment.Owner,description,status=assignment.Status,lang=request.Lang=="ar"?"ar":"en",method=assignment.Method,meta=JsonSerializer.Serialize(new{reference,assigned_to=assignment.Owner})}, ct));
        await InAppNotify.PushCaseOpenedAsync(db, caseId, reference, id, assignment.UnitId, assignment.Owner, "medium", id, "Career", ct);
        await Event(db,id,null,"counsellor_requested",new{note=request.Note,case_id=caseId,reference});
        var result=new{id=caseId,reference,status=assignment.Status,createdAt=now,firstResponseDueAt=now.AddHours(24),resolutionDueAt=now.AddDays(10)};
        return new{created=true,request=result,acknowledgement=request.Lang=="ar"?$"تم استلام طلب الإرشاد المهني. الرقم المرجعي {reference}.":$"Your career counselling request has been received. Reference {reference}."};
    }

    private async Task<object> Preferences(Guid id)
        => await ReadPreferences(sql, id);

    private static async Task<object> ReadPreferences(ISqlConnectionFactory sql, Guid id)
    {
        await using var db=sql.Create(); var r=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Career_GetPreferences",new{id}, CancellationToken.None));
        return new{preferredRoles=Arr((string?)r?.preferred_roles),preferredFields=Arr((string?)r?.preferred_fields),preferredSectors=Arr((string?)r?.preferred_sectors),workOrientation=(string?)r?.work_orientation,latestCvId=(Guid?)r?.latest_cv_id,counsellorRequested=(bool?)r?.counsellor_requested??false};
    }

    private async Task<object> Analyse(Guid id,string? target,bool persist,CancellationToken ct)
        => await AnalyseStudent(sql, id, target, persist, ct);

    // Shared with chat: keep one scoring implementation for the Career page and snapshot.
    internal static async Task<object> AnalyseStudent(ISqlConnectionFactory sql,Guid id,string? target,bool persist,CancellationToken ct)
    {
        await using var db=sql.Create();
        var cv=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Career_GetCurrentCv",new{id}, ct));
        var pref=await ReadPreferences(sql,id);
        var student=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Career_GetStudentProfile",new{id}, ct));
        var courses=(await db.QueryAsync(DbProc.Call("usp_Career_ListCompletedCourses",new{id}, ct))).ToArray();
        var internship=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Career_GetInternship",new{id}, ct));
        var roles=(await db.QueryAsync(DbProc.Call("usp_Career_ListActiveRoles", null, ct))).ToArray();
        var cvExists=cv is not null; var usable=cvExists&&(string?)cv.parsing_status!="failed"&&((string?)cv.parsed_text)?.Length>=60;
        var raw=usable?(string?)cv.parsed_text??"":""; var terms=Tokens(raw); var programme=(string?)student?.programme_en??""; var courseText=string.Join(' ',courses.Select(c=>$"{c.code} {c.title}"));
        var matches=roles.Select(r=>ScoreRole(r,terms,programme,courseText,internship is not null,pref,usable,(string?)student?.programme_ar)).OrderByDescending(x=>x.fitScore).Take(5).ToArray();
        var topRole=roles.FirstOrDefault(r=>(string)r.role_code==target)??roles.FirstOrDefault(r=>(Guid)r.id==(matches.FirstOrDefault()?.roleId??Guid.Empty));
        var top=matches.FirstOrDefault(m=>m.roleId==((Guid?)topRole?.id??Guid.Empty))??matches.FirstOrDefault();
        var gaps=BuildGaps(topRole,terms,courseText,usable);

        AtsScoreDto? ats = null;
        RoleAtsScoreDto[] roleAts = [];
        if (usable)
        {
            var parsed = CvHeuristicParser.MergeStored((string?)cv.parsed_profile_json, raw);
            var atsEvidence = new StudentAtsEvidence
            {
                hasProfile = student is not null,
                programmeEn = programme,
                hasInternship = internship is not null,
                completedCourses = courses.Select(c => ((string)c.code, (string)c.title)).ToList(),
            };
            var cvVersion = (string?)cv.content_sha256 ?? ((Guid?)cv.id)?.ToString("D");
            CareerRoleAtsInput? ToRoleInput(dynamic? r) => r is null ? null : new CareerRoleAtsInput
            {
                id = (Guid)r.id,
                role_code = (string)r.role_code,
                title_en = (string)r.title_en,
                title_ar = (string)r.title_ar,
                required_hard_skills = Arr((string?)r.required_hard_skills),
                preferred_hard_skills = Arr((string?)r.preferred_hard_skills),
                preferred_tools = Arr((string?)r.preferred_tools),
                preferred_courses = Arr((string?)r.preferred_courses),
                certifications = Arr((string?)r.certifications),
                suitable_programmes = Arr((string?)r.suitable_programmes),
                ats_keywords = Arr((string?)r.ats_keywords),
                experience_expectations = (string?)r.experience_expectations,
                portfolio_expectations = (string?)r.portfolio_expectations,
            };
            ats = AtsScoringEngine.ScoreGeneral(parsed, raw, (string?)cv.parsing_status, atsEvidence, ToRoleInput(topRole), cvVersion);
            roleAts = matches.Take(3)
                .Select(m => roles.FirstOrDefault(r => (Guid)r.id == m.roleId))
                .Where(r => r is not null)
                .Select(r => AtsScoringEngine.ScoreRole(ToRoleInput(r)!, parsed, raw, atsEvidence, cvVersion))
                .ToArray();
        }

        var evidence=new{hasProfile=student is not null,studentNumber=(string?)student?.student_number,programmeEn=(string?)student?.programme_en,programmeAr=(string?)student?.programme_ar,gpa=(decimal?)student?.cumulative_gpa,level=(string?)student?.academic_level,completedCredits=(int?)student?.completed_credit_hours??0,totalCredits=(int?)student?.total_credit_hours,expectedGraduation=student?.expected_graduation_date,completedCourses=courses.Select(c=>new{code=(string)c.code,title=(string)c.title,grade=(string?)c.grade}),hasInternship=internship is not null,internshipTitle=(string?)internship?.title};
        var actionPlan=topRole is null||top is null?Array.Empty<object>():BuildPlan(topRole,top,gaps,internship is not null,ats);
        var previous=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Career_GetLatestAnalysis",new{id}, ct));
        var version=(int?)previous?.version_no??0; var source=usable?"academic_cv":"academic"; if(previous is null||(string)previous.profile_source!=source||(string?)previous.cv_file_name!=(usable?(string?)cv.file_name:null))version++;
        var now=DateTimeOffset.UtcNow; var weights=usable?new{programme=15,coursework=15,hardSkills=20,experience=15,tools=10,certifications=5,softSkills=5,preference=15}:new{programme=35,coursework=30,hardSkills=10,experience=10,tools=3,certifications=2,softSkills=2,preference=8};
        if(persist)
        {
            await db.ExecuteAsync(DbProc.Call("usp_Career_DeleteRoleMatches",new{id}, ct));
            foreach(var m in matches)await db.ExecuteAsync(DbProc.Call("usp_Career_InsertRoleMatch",new{id,cvId=usable?(Guid?)cv.id:null,role=m.roleId,fit=m.fitScore,program=m.breakdown.programme,course=m.breakdown.coursework,skills=m.breakdown.hardSkills,experience=m.breakdown.experience,tools=m.breakdown.tools,certs=m.breakdown.certifications,soft=m.breakdown.softSkills,preference=m.breakdown.preference,ready=m.jobReadinessScore,evidence=JsonSerializer.Serialize(m.matchedEvidence),missing=JsonSerializer.Serialize(m.missingRequirements),breakdown=JsonSerializer.Serialize(m.skillBreakdown)}, ct));
            await db.ExecuteAsync(DbProc.Call("usp_Career_MergeLatestCv",new{id,cvId=usable?(Guid?)cv.id:null,now}, ct));
            await Event(db,id,usable?(Guid?)cv.id:null,"analysis_run",new{topRole=matches.FirstOrDefault()?.roleCode,atsScore=ats?.overall,profileSource=source,versionNo=version,version="career-fit.v1"});
        }
        return new{hasCv=cvExists,cvAnalyzed=usable,cvId=cvExists?(Guid?)cv.id:null,cvFileName=cvExists?(string?)cv.file_name:null,cvUploadedAt=cvExists?cv.uploaded_at:null,parsingStatus=cvExists?(string?)cv.parsing_status:null,profileSource=source,versionNo=version,weights,evidence,matches,ats,roleAts,atsHistory=(object?)null,skillGaps=gaps,actionPlan,injectionFlagged=cvExists&&Arr((string?)cv.injection_flags).Length>0,discrepancies=cvExists?Arr((string?)cv.discrepancies):[],calculatedAt=now,previousVersion=(object?)null,rankingChange=(object?)null};
    }

    private static dynamic ScoreRole(dynamic r,HashSet<string> terms,string programme,string courseText,bool internship,dynamic prefs,bool usable,string? programmeAr=null)
    {
        var required=Arr((string?)r.required_hard_skills);var preferred=Arr((string?)r.preferred_hard_skills);var tools=Arr((string?)r.preferred_tools);var roleCourses=Arr((string?)r.preferred_courses);var certs=Arr((string?)r.certifications);var suitable=Arr((string?)r.suitable_programmes);
        bool Has(string value,string hay)=>Tokens(hay).Overlaps(Tokens(value)); bool Cv(string x)=>Has(x,string.Join(' ',terms)); bool Course(string x)=>Has(x,courseText);
        var matchedReq=required.Where(x=>Cv(x)||Course(x)).ToArray();var missingReq=required.Except(matchedReq).ToArray();var matchedTools=tools.Where(Cv).ToArray();var missingTools=tools.Except(matchedTools).ToArray();var matchedCourses=roleCourses.Where(Course).ToArray();var missingCourses=roleCourses.Except(matchedCourses).ToArray();
        double P(int a,int b)=>b==0?1:(double)a/b;var program=suitable.Any(x=>ProgrammeMatches(programme,x))?1:ProgrammeMatches(programme,((string?)r.career_family??"").Replace('_',' '))?.6:.25;var hard=.75*P(matchedReq.Length,required.Length)+.25*P(preferred.Count(Cv),preferred.Length);var exp=internship?.35:0;var tool=P(matchedTools.Length,tools.Length);var cert=certs.Length==0?.6:P(certs.Count(Cv),certs.Length);var course=P(matchedCourses.Length,roleCourses.Length);
        var score=usable?Math.Round(program*15+course*15+hard*20+exp*15+tool*10+cert*5+10):Math.Round((program*35+course*30+hard*10+exp*10+4)/93*100);
        var missing=new List<string>();if(missingReq.Length>0)missing.Add($"Missing core skills: {string.Join(", ",missingReq)}");if(missingTools.Length>0)missing.Add($"Unfamiliar tools: {string.Join(", ",missingTools.Take(4))}");if(!internship)missing.Add((string?)r.experience_expectations??"No applied experience evidenced yet.");
        var evidence=new List<object>();if(program>=1)evidence.Add(new{source="university",textEn=$"{programme} programme",textAr=$"برنامج {(string.IsNullOrWhiteSpace(programmeAr)?programme:programmeAr)}"});if(matchedCourses.Length>0)evidence.Add(new{source="university",textEn=$"Completed {string.Join(", ",matchedCourses.Take(4))}",textAr=$"مواد مكتملة: {string.Join("، ",matchedCourses.Take(4))}"});if(matchedReq.Length>0)evidence.Add(new{source="cv",textEn=$"CV demonstrates {string.Join(", ",matchedReq.Take(5))}",textAr=$"تُظهر السيرة الذاتية: {string.Join("، ",matchedReq.Take(5))}"});
        return new{roleId=(Guid)r.id,roleCode=(string)r.role_code,titleEn=(string)r.title_en,titleAr=(string)r.title_ar,careerFamily=(string)r.career_family,fitScore=(int)Math.Clamp(score,0,100),jobReadinessScore=(int)Math.Round(100*(.45*P(matchedReq.Length,required.Length)+.25*exp+.2*tool+.1*cert)),breakdown=new{programme=Math.Round(program*(usable?15:37.6),1),coursework=Math.Round(course*(usable?15:32.3),1),hardSkills=Math.Round(hard*(usable?20:10.8),1),experience=Math.Round(exp*(usable?15:10.8),1),tools=usable?Math.Round(tool*10,1):0,certifications=usable?Math.Round(cert*5,1):0,softSkills=0,preference=usable?10:4.3},matchedEvidence=evidence.Select(x=>(string)((dynamic)x).textEn).ToArray(),evidenceItems=evidence,missingRequirements=missing,skillBreakdown=new{matchedRequired=matchedReq,missingRequired=missingReq,matchedPreferred=preferred.Where(Cv),missingPreferred=preferred.Where(x=>!Cv(x)),matchedTools,missingTools,matchedCourses,missingCourses,cvSkills=matchedReq}};
    }

    private static object BuildGaps(dynamic? role,HashSet<string> terms,string courses,bool hasCv){if(role is null)return new{preliminary=!hasCv,targetRoleEn=(string?)null,targetRoleAr=(string?)null,strong=Array.Empty<object>(),developing=Array.Empty<object>(),missing=Array.Empty<object>()};var all=Arr((string?)role.required_hard_skills).Select(x=>(skill:x,required:true)).Concat(Arr((string?)role.preferred_hard_skills).Select(x=>(skill:x,required:false))).Concat(Arr((string?)role.preferred_tools).Select(x=>(skill:x,required:false))).DistinctBy(x=>x.skill,StringComparer.OrdinalIgnoreCase).ToArray();bool Has(string value,string hay)=>Tokens(hay).Overlaps(Tokens(value));return new{preliminary=!hasCv,targetRoleEn=(string)role.title_en,targetRoleAr=(string)role.title_ar,strong=all.Where(x=>hasCv&&Has(x.skill,string.Join(' ',terms))).Select(x=>new{x.skill,source="cv",x.required}),developing=all.Where(x=>!(hasCv&&Has(x.skill,string.Join(' ',terms)))&&Has(x.skill,courses)).Select(x=>new{x.skill,source="coursework",x.required}),missing=all.Where(x=>!Has(x.skill,string.Join(' ',terms))&&!Has(x.skill,courses)).OrderByDescending(x=>x.required).Select(x=>new{x.skill,source="recommended",x.required})};}
    private static object[] BuildPlan(dynamic role, dynamic top, dynamic gaps, bool internship, AtsScoreDto? ats)
    {
        var list = new List<object>();
        var missing = ((IEnumerable<dynamic>)gaps.missing).Select(x => (string)x.skill).Take(3).ToArray();
        if (missing.Length > 0)
            list.Add(new { horizon = "30_days", titleEn = $"Start closing the core skill gap for {(string)role.title_en}", titleAr = $"ابدأ بسد فجوة المهارات الأساسية لدور {(string)role.title_ar}", detailEn = $"Focus first on: {string.Join(", ", missing)}.", detailAr = $"ركّز أولاً على: {string.Join("، ", missing)}." });
        if (!internship)
            list.Add(new { horizon = "before_graduation", titleEn = "Secure an internship placement through Sanadi", titleAr = "احصل على فرصة تدريب عملي عبر سندي", detailEn = (string?)role.experience_expectations ?? "Applied experience is expected for this role.", detailAr = "يُتوقع وجود خبرة تطبيقية لهذا الدور." });
        if (ats?.improvements.Count > 0)
            list.Add(new { horizon = "30_days", titleEn = "Improve ATS readiness of your CV", titleAr = "حسّن جاهزية سيرتك الذاتية لأنظمة تتبع المتقدمين (ATS)", detailEn = string.Join(" ", ats.improvements.Take(3).Select(i => i.en)), detailAr = string.Join(" ", ats.improvements.Take(3).Select(i => i.ar)) });
        return list.ToArray();
    }

    private static (string code,string severity,string detail)[] Scan(byte[] b,string mime,string name){var f=new List<(string,string,string)>();if(Regex.IsMatch(name,@"\.(exe|dll|scr|bat|cmd|com|js|vbs|ps1|hta|jar|apk|msi)$",RegexOptions.IgnoreCase))f.Add(("executable_extension","malicious","Executable file extension."));if(b.Length>=2&&b[0]==0x4d&&b[1]==0x5a)f.Add(("pe_executable","malicious","Windows executable header."));var head=Encoding.Latin1.GetString(b,0,Math.Min(b.Length,20000));if(head.Contains("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR"))f.Add(("eicar_test_file","malicious","EICAR antivirus test signature."));if(mime=="application/pdf"&&!head.StartsWith("%PDF"))f.Add(("type_mismatch","malicious","Declared as PDF but the content is not a PDF."));if(mime.Contains("openxml")&&!(b.Length>2&&b[0]==0x50&&b[1]==0x4b))f.Add(("type_mismatch","malicious","Declared as Word but the content is not a Word container."));if(mime=="application/pdf"){if(Regex.IsMatch(head,@"/JavaScript\b|/JS\b"))f.Add(("pdf_javascript","suspicious","The PDF contains embedded JavaScript."));if(head.Contains("/Launch"))f.Add(("pdf_launch_action","malicious","The PDF contains a launch action."));if(head.Contains("/EmbeddedFile"))f.Add(("pdf_embedded_file","suspicious","The PDF contains an embedded file."));}if(mime=="text/plain"&&Regex.IsMatch(head,@"<script\b|javascript:|\beval\s*\(|powershell\s+-enc",RegexOptions.IgnoreCase))f.Add(("active_content_in_text","suspicious","Script-like content inside a plain-text CV."));if(mime.Contains("openxml")&&b.Length>0)try{using var z=new ZipArchive(new MemoryStream(b));foreach(var e in z.Entries){var n=e.FullName.ToLowerInvariant();if(n.Contains("vbaproject.bin")||n.StartsWith("word/embeddings/"))f.Add(("office_active_content","suspicious",$"Active Office content: {e.FullName}"));if(Regex.IsMatch(n,@"\.(exe|dll|scr|bat|cmd|js|vbs|ps1|jar)$"))f.Add(("embedded_executable","malicious",$"Executable payload: {e.FullName}"));}}catch{f.Add(("corrupt_container","suspicious","The Office container could not be opened."));}return f.Select(x=>(x.Item1,x.Item2,x.Item3)).ToArray();}
    private static string Extract(byte[] b,string mime){if(mime=="text/plain")return Encoding.UTF8.GetString(b);if(mime.Contains("openxml"))try{using var z=new ZipArchive(new MemoryStream(b));var e=z.GetEntry("word/document.xml");if(e is null)return "";using var s=e.Open();var x=XDocument.Load(s);return string.Join(' ',x.Descendants().Where(n=>n.Name.LocalName=="t").Select(n=>n.Value));}catch{return "";}if(mime=="application/pdf"){var latin=Encoding.Latin1.GetString(b);return string.Join(' ',Regex.Matches(latin,@"\(([^()]*)\)\s*Tj").Select(m=>m.Groups[1].Value));}return "";}
    private static object ParseProfile(string text) => CvHeuristicParser.Parse(text);
    private static object[] InjectionFlags(string text){var rules=new[]{("instruction_override",@"\b(ignore|disregard|forget)\b.{0,40}\b(previous|prior|above|earlier|all)\b.{0,20}\b(instruction|prompt|rule)"),("role_hijack",@"\b(you are now|act as|pretend to be|system prompt|as an ai)\b"),("score_manipulation",@"\b(give|assign|set|award)\b.{0,30}\b(100|full|maximum|highest)\b.{0,20}\b(score|rating|match)")};return rules.Where(x=>Regex.IsMatch(text,x.Item2,RegexOptions.IgnoreCase|RegexOptions.Singleline)).Select(x=>(object)new{code=x.Item1,excerpt="Directive-like content removed"}).ToArray();}
    private static string Sanitise(string text)=>Regex.Replace(text.Replace("\0"," "),@"(?im)^.*(ignore previous|you are now|system prompt|give.{0,30}(100|maximum).{0,20}(score|rating)).*$","[removed non-CV content]")[..Math.Min(text.Length,40000)];
    private static string DetectLanguage(string text){var ar=text.Count(c=>c is >= '\u0600' and <= '\u06ff');var latin=text.Count(char.IsLetter)-ar;return ar>latin*2?"ar":ar>40?"mixed":"en";}
    private static string[] Arr(string? json){if(string.IsNullOrWhiteSpace(json))return [];try{return JsonSerializer.Deserialize<string[]>(json)??[];}catch{return [];}}
    private static HashSet<string> Tokens(string text)=>Regex.Matches(text.ToLowerInvariant(),@"[\p{L}\p{N}+#.]{2,}").Select(x=>x.Value).ToHashSet(StringComparer.OrdinalIgnoreCase);
    // Programme fit is a phrase match, not a token overlap: "BSc Mathematical Sciences" must not
    // match "BSc Data Science and Artificial Intelligence" just because both say "BSc".
    internal static bool ProgrammeMatches(string programme,string suitable)
    {
        static string Norm(string v)=>Regex.Replace(Regex.Replace(Regex.Replace(v.ToLowerInvariant(),@"[\u2018\u2019']",""),@"[^a-z0-9+#./ -]"," "),@"\s+"," ").Trim();
        var h=Norm(programme);var n=Norm(suitable);
        if(h.Length==0||n.Length==0)return false;
        if(h==n)return true;
        return (h.Contains(n,StringComparison.Ordinal)||n.Contains(h,StringComparison.Ordinal))&&Math.Min(h.Length,n.Length)>=3;
    }
    private static Task Event(System.Data.Common.DbConnection db,Guid student,Guid? cv,string type,object details)=>db.ExecuteAsync(DbProc.Call("usp_Career_InsertEvent",new{student,cv,type,json=JsonSerializer.Serialize(details)}, CancellationToken.None));
}
