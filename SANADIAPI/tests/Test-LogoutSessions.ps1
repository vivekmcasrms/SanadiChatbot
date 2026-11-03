param([string]$Server = '(localdb)\MSSQLLocalDB')
$ErrorActionPreference = 'Stop'
$testSchema = 'sanadi_logout_test_' + [Guid]::NewGuid().ToString('N')
$migration = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../sql/2026-09-28-logout-session-revocation.sql'))
$migration = $migration.Replace('auth.', ($testSchema + '.')).Replace('dbo.', ($testSchema + '.'))
$tests = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'logout-sessions.test.sql')).Replace('__SCHEMA__', $testSchema)
$script = "SET NOCOUNT ON; SET XACT_ABORT ON;`nBEGIN TRANSACTION;`nEXEC(N'CREATE SCHEMA [$testSchema]');`nCREATE TABLE [$testSchema].refresh_tokens (user_id uniqueidentifier, token_hash nvarchar(128) PRIMARY KEY, expires_at datetimeoffset, revoked_at datetimeoffset NULL);`nGO`n" + $migration + "`n" + $tests + "`nIF @@TRANCOUNT > 0 ROLLBACK;`nGO`n"
$testFile = Join-Path ([IO.Path]::GetTempPath()) ($testSchema + '.sql')
try {
    [IO.File]::WriteAllText($testFile, $script, (New-Object Text.UTF8Encoding($false)))
    & sqlcmd -S $Server -E -C -d tempdb -l 5 -t 30 -b -f 65001 -i $testFile
    if ($LASTEXITCODE -ne 0) { throw 'Logout session regression checks failed.' }
} finally { Remove-Item -LiteralPath $testFile -ErrorAction SilentlyContinue }
