/* Gateway authorization contract for C# ticket and survey notifications.
   Rerunnable. No SSO flow, ticket assignment, settings values or stored tokens
   are modified. Configure AuthApiUrl with the full gateway token endpoint in
   the correct ApplicationSettings environment row before enabling delivery.
*/
CREATE OR ALTER PROCEDURE dbo.usp_TicketEmail_GetAuthorization
    @IsProduction bit,
    @ActorId uniqueidentifier
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP(1)
        s.AuthApiUrl AS ApiUrl,
        s.EmailApiAppName AS ClientId,
        s.StudentApiClientSecret AS ClientSecret,
        a.email AS AccountEmail,
        s.HeaderDomain AS EmailDomain
    FROM dbo.ApplicationSettings s
    JOIN auth.users a ON a.id=@ActorId
    JOIN dbo.profiles p ON p.id=a.id AND p.deleted_at IS NULL AND p.access_revoked_at IS NULL
    WHERE s.IsActive=1 AND s.IsProductionEntry=@IsProduction
      AND EXISTS(SELECT 1 FROM auth.login_sessions ls
        WHERE ls.user_id=a.id AND ls.revoked_at IS NULL
          AND EXISTS(SELECT 1 FROM auth.refresh_tokens rt WHERE rt.session_id=ls.id
            AND rt.revoked_at IS NULL AND rt.expires_at>SYSDATETIMEOFFSET()))
    ORDER BY s.UpdatedAtUtc DESC,s.Id DESC;
END;
GO
