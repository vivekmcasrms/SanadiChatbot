using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Sanadi.Api.Security;
using Sanadi.Application.Documents;
using Sanadi.Application.Storage;
using Sanadi.Domain.Exceptions;
using Sanadi.Infrastructure.Persistence;

namespace Sanadi.Api.Controllers;

[ApiController, Route("api/documents")]
public sealed class DocumentsController(ISqlConnectionFactory sql, IObjectStorage storage, IEnrolmentLetterIssuer letters, IConfiguration configuration) : ControllerBase
{
    private Guid UserId(){var u=HttpContext.GetSanadiUser();if(!u.IsAuthenticated||u.UserId is not Guid id)throw new UnauthorizedException();return id;}
    private async Task<Guid>Admin(bool auditor=false){var id=UserId();await using var db=sql.Create();var roles=(await db.QueryAsync<string>(DbProc.Call("usp_Documents_GetUserRoles",new{id},CancellationToken.None))).ToHashSet(StringComparer.OrdinalIgnoreCase);if(!roles.Contains("system_admin")&&!(auditor&&roles.Contains("auditor")))throw new ForbiddenException();return id;}
    public sealed record PageRequest(string? Search,int Page=1,int PageSize=10);
    public sealed record Fields(bool? IncludeProgramme,bool? IncludeCollege,bool? IncludeTerm,bool? IncludeExpectedGraduation);
    public sealed record IssueRequest(string? Language,string? Purpose,Fields? Fields,Guid? ConversationId);
    public sealed record DocumentRequest(Guid DocumentId,string? Mode=null,string? Reason=null);
    public sealed record RetentionRequest(string DocumentType,int RetentionDays);
    public sealed record TemplatePreview(string Language,string Title,string? HeaderText,string BodyTemplate,string? FooterText,string? SignatoryBlock,string? Disclaimer);
    public sealed record TemplateSave(Guid Id,string Title,string? HeaderText,string BodyTemplate,string? FooterText,string? SignatoryBlock,string? Disclaimer,int? ValidityDays,bool? IsActive);

    private string? RequestOrigin()
    {
        var fwdHost = Request.Headers["X-Forwarded-Host"].FirstOrDefault()?.Split(',')[0]?.Trim();
        var fwdProto = Request.Headers["X-Forwarded-Proto"].FirstOrDefault()?.Split(',')[0]?.Trim();
        if (!string.IsNullOrWhiteSpace(fwdHost))
            return $"{(fwdProto is "http" or "https" ? fwdProto : "https")}://{fwdHost}";
        return $"{Request.Scheme}://{Request.Host}";
    }

    [HttpPost("state")]
    public async Task<object>State([FromBody]PageRequest? r)
    {
        var id=UserId();r??=new(null);var page=Math.Max(1,r.Page);var size=Math.Clamp(r.PageSize,5,50);var term=(r.Search??"").Trim();await using var db=sql.Create();var ctx=await Context(db,id);var like=term.Length>0?$"%{term[..Math.Min(60,term.Length)]}%":null;var total=await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Documents_CountIssued",new{id,like},CancellationToken.None));var rows=await db.QueryAsync(DbProc.Call("usp_Documents_ListIssued",new{id,like,skip=(page-1)*size,take=size},CancellationToken.None));var now=DateTimeOffset.UtcNow;var docs=rows.Select(d=>{DateTimeOffset? retention=(DateTimeOffset?)d.retention_expires_at;var live=retention is null||retention>now;return new{id=(Guid)d.id,referenceNumber=(string)d.reference_number,documentType=(string)d.document_type,titleEn=(string)d.title_en,titleAr=(string)d.title_ar,language=(string)d.language,purpose=(string)d.purpose,status="valid",issuedAt=d.issued_at,expiresAt=d.expires_at,availableUntil=retention,daysRemaining=retention is null?(int?)null:Math.Max(0,(int)Math.Ceiling((retention.Value-now).TotalDays)),downloadable=live&&d.file_path is not null,deletable=true,verifyPath=live?$"/verify/{d.secure_verification_token}":null,isDemoDocument=(bool)d.is_demo_document};});return new{letterContext=ctx,documents=docs,total,page,pageSize=size,pageCount=Math.Max(1,(int)Math.Ceiling(total/(double)size))};
    }

    [HttpPost("issue")]
    public async Task<object> Issue([FromBody] IssueRequest r, CancellationToken ct)
    {
        var id = UserId();
        var fields = new LetterFieldFlags(
            IncludeProgramme: r.Fields?.IncludeProgramme ?? true,
            IncludeCollege: r.Fields?.IncludeCollege ?? true,
            IncludeTerm: r.Fields?.IncludeTerm ?? true,
            IncludeExpectedGraduation: r.Fields?.IncludeExpectedGraduation ?? false);
        var issued = await letters.IssueAsync(id, r.Language ?? "en", r.Purpose ?? "general", fields, r.ConversationId, RequestOrigin(), ct);
        return new
        {
            letter = new
            {
                id = issued.Id,
                referenceNumber = issued.ReferenceNumber,
                language = issued.Language,
                purpose = issued.Purpose,
                status = issued.Status,
                issuedAt = issued.IssuedAt,
                expiresAt = issued.ExpiresAt,
                retentionExpiresAt = issued.RetentionExpiresAt,
                retentionDays = issued.RetentionDays,
                verifyUrl = issued.VerifyUrl,
                verifyToken = issued.VerifyToken,
                documentHash = issued.DocumentHash,
                templateVersion = issued.TemplateVersion,
                isDemoDocument = issued.IsDemoDocument,
                fileName = issued.FileName
            },
            replayed = issued.Replayed
        };
    }

    [HttpPost("download")]
    public async Task<object> Download([FromBody] DocumentRequest r, CancellationToken ct)
    {
        var id = UserId();
        await using var db = sql.Create();
        var d = await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Documents_GetForDownload", new { r.DocumentId, id }, ct))
            ?? throw new NotFoundException("This document is no longer available for download.");
        if ((string)d.document_status == "revoked") throw new SanadiException("This document has been revoked.");
        if (d.retention_expires_at is DateTimeOffset until && until < DateTimeOffset.UtcNow)
            throw new SanadiException("This document has passed its availability period and can no longer be downloaded.");
        var signed = await storage.CreateSignedUrlAsync("student-letters", (string)d.file_path, 300, HttpContext.GetSanadiUser(), ct);
        // CreateSignedUrl returns /object/sign/... for supabase-js; browsers need an absolute API URL.
        var relative = signed.StartsWith("/object/", StringComparison.OrdinalIgnoreCase)
            ? "/storage/v1" + signed
            : signed.StartsWith("/storage/", StringComparison.OrdinalIgnoreCase)
                ? signed
                : "/storage/v1/object/sign/student-letters/" + ((string)d.file_path).TrimStart('/');
        if (!relative.Contains('?', StringComparison.Ordinal) && signed.Contains('?', StringComparison.Ordinal))
            relative += signed[signed.IndexOf('?', StringComparison.Ordinal)..];
        var url = DownloadBaseUrl(Request, configuration["Storage:PublicBaseUrl"]) + relative;
        await db.ExecuteAsync(DbProc.Call("usp_Documents_RecordDownload", new { r.DocumentId, reference = (string)d.reference_number, id }, ct));
        return new { url, fileName = $"{d.reference_number}.pdf" };
    }

    internal static string DownloadBaseUrl(HttpRequest request, string? configuredBaseUrl)
    {
        // IIS may forward HTTPS requests internally as HTTP. Use the public API
        // address from appsettings.json instead of exposing that internal scheme.
        if (!string.IsNullOrWhiteSpace(configuredBaseUrl))
        {
            var value = configuredBaseUrl.Trim().TrimEnd('/');
            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
                (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp) ||
                !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
                throw new SanadiException("The document download URL is not configured correctly.");
            return value;
        }
        return $"{request.Scheme}://{request.Host}{request.PathBase}";
    }

    [HttpPost("delete")]
    public async Task<object>Delete([FromBody]DocumentRequest r,CancellationToken ct){var id=UserId();await using var db=sql.Create();var d=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Documents_GetForDelete",new{r.DocumentId,id},ct))??throw new NotFoundException("This document is not available.");var tokenHash=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes((string)d.secure_verification_token))).ToLowerInvariant();await db.ExecuteAsync(DbProc.Call("usp_Documents_DeleteStudentDocument",new{r.DocumentId,id,tokenHash,reference=(string)d.reference_number},ct));if(d.file_path is string path)await storage.DeleteAsync("student-letters",[path],HttpContext.GetSanadiUser(),ct);return new{reference=(string)d.reference_number};}

    [HttpGet("retention")]
    public async Task<object>Retention(){UserId();await using var db=sql.Create();return await db.QueryAsync(DbProc.Call("usp_Documents_ListRetentionPolicies",null,CancellationToken.None));}
    [HttpPost("retention")]
    public async Task<object>RetentionSave([FromBody]RetentionRequest r){var actor=await Admin();if(r.RetentionDays is <1 or >365)throw new SanadiException("Invalid retention period.");await using var db=sql.Create();await db.ExecuteAsync(DbProc.Call("usp_Documents_UpdateRetention",new{r.RetentionDays,r.DocumentType,actor,meta=JsonSerializer.Serialize(r)},CancellationToken.None));return new{ok=true};}

    [AllowAnonymous, HttpGet("verify")]
    public async Task<object>Verify([FromQuery]string token){if(token.Length is <32 or >128||!Regex.IsMatch(token,"^[A-Za-z0-9_-]+$"))return new{found=false};var client=$"{HttpContext.Connection.RemoteIpAddress}|{Request.Headers.UserAgent}";var clientHash=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(client))).ToLowerInvariant()[..40];var tokenHash=Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();await using var db=sql.Create();var recent=await db.ExecuteScalarAsync<int>(DbProc.Call("usp_Documents_CountRecentVerifyAttempts",new{clientHash},CancellationToken.None));if(recent>=20)return new{found=false,rateLimited=true};var d=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Documents_GetByVerifyToken",new{token},CancellationToken.None));var outcome=d is null?"not_found":(string)d.document_status;await db.ExecuteAsync(DbProc.Call("usp_Documents_InsertVerifyAttempt",new{tokenHash,clientHash,outcome},CancellationToken.None));if(d is null)return new{found=false};var expired=d.expires_at is DateTimeOffset x&&x<DateTimeOffset.UtcNow;var status=(string)d.document_status=="revoked"||d.deleted_at is not null?"withdrawn":expired?"expired":"valid";await db.ExecuteAsync(DbProc.Call("usp_Documents_BumpVerificationCount",new{id=(Guid)d.id},CancellationToken.None));return new{found=true,status,reference=(string)d.reference_number,documentType=(string)d.document_type,titleEn=(string)d.title_en,titleAr=(string)d.title_ar,language=(string)d.language,issuedAt=d.issued_at,expiresAt=d.expires_at,studentName=(string?)d.full_name,studentNameAr=(string?)d.full_name,programme=(string?)d.programme,programmeAr=(string?)d.programme_ar,college=(string?)d.college,collegeAr=(string?)d.college_ar,isDemoDocument=(bool)d.is_demo_document,documentHash=(string?)d.document_hash,digitallySigned=(bool)d.digitally_signed,rateLimited=false};}

    [HttpGet("admin")]
    public async Task<object>AdminOverview(){await Admin(true);await using var db=sql.Create();var docs=(await db.QueryAsync(DbProc.Call("usp_Documents_AdminListDocuments",null,CancellationToken.None))).ToArray();var events=(await db.QueryAsync(DbProc.Call("usp_Documents_AdminListEvents",null,CancellationToken.None))).ToArray();return new{documents=docs,events,totals=new{issued=docs.Length,valid=docs.Count(x=>(string)x.document_status=="valid"),revoked=docs.Count(x=>(string)x.document_status=="revoked"),downloads=docs.Sum(x=>(int)x.download_count),verifications=docs.Sum(x=>(int)x.verification_count),failures=events.Count(x=>(string)x.event_type=="generation_failed")}};}
    [HttpPost("revoke")]
    public async Task<object>Revoke([FromBody]DocumentRequest r){var actor=await Admin();if((r.Reason??"").Trim().Length<5)throw new SanadiException("A revocation reason is required.");await using var db=sql.Create();var d=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Documents_GetReference",r,CancellationToken.None))??throw new NotFoundException();await db.ExecuteAsync(DbProc.Call("usp_Documents_Revoke",new{r.DocumentId,r.Reason,actor,reference=(string)d.reference_number,details=JsonSerializer.Serialize(new{reason=r.Reason})},CancellationToken.None));return new{ok=true,reference=(string)d.reference_number};}

    [HttpGet("templates")]
    public async Task<object>Templates(){await Admin();await using var db=sql.Create();return await db.QueryAsync(DbProc.Call("usp_Documents_ListTemplates",null,CancellationToken.None));}
    [HttpPost("templates/preview")]
    public async Task<object>Preview([FromBody]TemplatePreview r){await Admin();var sample=r.Language=="ar"?new Dictionary<string,string>{{"student_name","سيف الشامسي"},{"student_id","202312345"},{"programme","بكالوريوس العلوم في علوم الحاسوب"},{"college","كلية تقنية المعلومات"},{"academic_term","فصل الربيع 2026"},{"issue_date","20 أغسطس 2026"},{"reference_number","UAEU-TWIMC-2026-000123"}}:new Dictionary<string,string>{{"student_name","Saif Al Shamsi"},{"student_id","202312345"},{"programme","Bachelor of Science in Computer Science"},{"college","College of Information Technology"},{"academic_term","Spring 2026"},{"issue_date","20 August 2026"},{"reference_number","UAEU-TWIMC-2026-000123"}};string FillSample(string? s)=>Regex.Replace(s??"",@"\{\{(\w+)\}\}",m=>sample.GetValueOrDefault(m.Groups[1].Value,m.Value));var unknown=Regex.Matches(r.BodyTemplate,@"\{\{(\w+)\}\}").Select(m=>m.Groups[1].Value).Where(x=>!sample.ContainsKey(x)).Distinct();return new{title=FillSample(r.Title),header=FillSample(r.HeaderText),body=FillSample(r.BodyTemplate),footer=FillSample(r.FooterText),signatory=FillSample(r.SignatoryBlock),disclaimer=FillSample(r.Disclaimer),unknownPlaceholders=unknown};}
    [HttpPost("templates")]
    public async Task<object>SaveTemplate([FromBody]TemplateSave r){var actor=await Admin();await using var db=sql.Create();var n=await db.ExecuteAsync(DbProc.Call("usp_Documents_UpdateTemplate",r,CancellationToken.None));if(n==0)throw new NotFoundException();await db.ExecuteAsync(DbProc.Call("usp_Documents_InsertTemplateAudit",new{actor,r.Id,meta=JsonSerializer.Serialize(new{r.Title,r.IsActive})},CancellationToken.None));return new{ok=true};}

    private static async Task<dynamic>Context(System.Data.Common.DbConnection db,Guid id){var r=await db.QuerySingleOrDefaultAsync(DbProc.Call("usp_Documents_GetStudentContext",new{id},CancellationToken.None));var exists=r is not null&&r.student_number is not null;var status=(string?)r?.account_status??"unknown";var reason=!exists?"No academic record is linked to this account, so an enrollment letter cannot be issued.":status!="active"?$"Your enrollment status is recorded as \"{status}\", so a letter confirming active enrollment cannot be issued.":r?.programme_en is null?"Your academic programme is missing from the student record, so the letter cannot state your programme.":null;return new{eligible=reason is null,blockingReason=reason,blockingReasonAr=reason,studentName=(string?)r?.full_name??(string?)r?.email??"UAEU student",studentNameAr=(string?)r?.full_name,studentNumber=(string?)r?.student_number,programmeEn=(string?)r?.programme_en,programmeAr=(string?)r?.programme_ar,collegeEn=(string?)r?.college_en,collegeAr=(string?)r?.college_ar,degreeLevel=(string?)r?.degree_level??(string?)r?.academic_level,enrollmentStatus=status,academicStanding=(string?)r?.academic_standing,termEn=(string?)r?.term_en,termAr=(string?)r?.term_ar,expectedGraduation=r?.expected_graduation_date,registeredCredits=(int?)r?.registered_credit_hours??0,campusEn=(string?)null,campusAr=(string?)null};}
}
