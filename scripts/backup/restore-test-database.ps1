[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BackupDirectory,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9]{20}$')][string]$TargetProjectRef,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9]{20}$')][string]$ProductionProjectRef,
  [Parameter(Mandatory = $true)][string]$Confirmation,
  [string]$ConnectionEnvironmentVariable = 'TEST_RESTORE_DATABASE_URL'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($TargetProjectRef -eq $ProductionProjectRef) {
  throw 'Restore target must not be the production project.'
}
$expectedConfirmation = "RESTORE TEST DATABASE $TargetProjectRef"
if ($Confirmation -cne $expectedConfirmation) {
  throw "Explicit confirmation is required: $expectedConfirmation"
}

$connectionString = [Environment]::GetEnvironmentVariable($ConnectionEnvironmentVariable)
if ([string]::IsNullOrWhiteSpace($connectionString)) {
  throw "Environment variable $ConnectionEnvironmentVariable is not configured."
}
if ($connectionString.Contains($ProductionProjectRef, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Connection string references the production project.'
}
if (-not $connectionString.Contains($TargetProjectRef, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Connection string does not reference the declared test project.'
}

$psql = Get-Command psql -ErrorAction SilentlyContinue
if ($null -eq $psql) {
  throw 'psql is required. Install a PostgreSQL 17-compatible client and verify psql --version.'
}

$backupPath = [System.IO.Path]::GetFullPath($BackupDirectory)
& (Join-Path $PSScriptRoot 'validate-backup.ps1') -BackupDirectory $backupPath
if ($LASTEXITCODE -ne 0) {
  throw 'Backup validation failed.'
}

$metadata = Get-Content -LiteralPath (Join-Path $backupPath 'backup-metadata.json') -Raw |
  ConvertFrom-Json
if ($metadata.kind -ne 'SUPABASE_POSTGRES_LOGICAL') {
  throw 'This script accepts only a logical PostgreSQL backup.'
}

$previousPgDatabase = $env:PGDATABASE
try {
  # The secret remains in the process environment and is never passed as a command-line argument.
  $env:PGDATABASE = $connectionString
  $restoreArguments = @(
    '--no-psqlrc',
    '--single-transaction',
    '--variable', 'ON_ERROR_STOP=1',
    '--command', 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated',
    '--file', (Join-Path $backupPath 'roles.sql'),
    '--file', (Join-Path $backupPath 'schema.sql'),
    '--command', 'SET session_replication_role = replica',
    '--file', (Join-Path $backupPath 'data.sql'),
    '--file', (Join-Path $backupPath 'history_schema.sql'),
    '--file', (Join-Path $backupPath 'history_data.sql')
  )
  & $psql.Source @restoreArguments
  if ($LASTEXITCODE -ne 0) {
    throw 'Test restore failed and the single transaction was rolled back.'
  }

  $validationArguments = @(
    '--no-psqlrc',
    '--variable', 'ON_ERROR_STOP=1',
    '--file', (Join-Path $PSScriptRoot 'validate-restored-database.sql')
  )
  & $psql.Source @validationArguments
  if ($LASTEXITCODE -ne 0) {
    throw 'Post-restore database validation failed.'
  }
}
finally {
  $env:PGDATABASE = $previousPgDatabase
}

Write-Output "Test restore and validation completed for project $TargetProjectRef."
