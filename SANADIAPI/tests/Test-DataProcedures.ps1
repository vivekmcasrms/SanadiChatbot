param([string]$Server = '(localdb)\MSSQLLocalDB')
$ErrorActionPreference = 'Stop'
$testSchema = 'sanadi_proc_test_' + [Guid]::NewGuid().ToString('N')
$migration = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../sql/2026-09-28-remaining-data-procedures.sql'))
$tests = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'remaining-data-procedures.test.sql'))
# A unique schema in tempdb plus one transaction keeps application data untouched.
$migration = $migration.Replace('dbo.', ($testSchema + '.')).Replace('[dbo]', ('[' + $testSchema + ']'))
$tests = $tests.Replace('__SCHEMA__', $testSchema)
$script = "SET XACT_ABORT ON;`nBEGIN TRANSACTION;`nEXEC(N'CREATE SCHEMA [$testSchema]');`nGO`n" + $migration + "`n" + $tests + "`nROLLBACK TRANSACTION;`nGO`n"
$testFile = Join-Path ([IO.Path]::GetTempPath()) ($testSchema + '.sql')
try {
    [IO.File]::WriteAllText($testFile, $script, (New-Object Text.UTF8Encoding($false)))
    & sqlcmd -S $Server -E -C -d tempdb -l 5 -t 30 -b -f 65001 -i $testFile
    if ($LASTEXITCODE -ne 0) { throw 'Stored procedure regression checks failed.' }
} finally {
    Remove-Item -LiteralPath $testFile -ErrorAction SilentlyContinue
}
