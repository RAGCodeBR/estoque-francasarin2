[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9]{20}$')][string]$ProjectRef
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
. (Join-Path $PSScriptRoot 'common.ps1')

# Required before every operational Supabase CLI invocation in this script.
Invoke-SupabasePreflight

$backupDirectory = New-ExternalBackupDirectory -OutputRoot $OutputRoot -Prefix "postgres-$ProjectRef" -WorkspaceRoot $workspaceRoot

$metadataPath = Join-Path $backupDirectory 'backup-metadata.json'
$cliVersion = (& npx --no-install supabase --version | Select-Object -First 1).Trim()
$gitCommit = (& git -C $workspaceRoot rev-parse HEAD 2> $null | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($gitCommit)) {
  $gitCommit = 'UNKNOWN'
}

$metadata = [ordered]@{
  kind = 'SUPABASE_POSTGRES_LOGICAL'
  status = 'INCOMPLETE'
  createdAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
  projectRef = $ProjectRef
  supabaseCliVersion = $cliVersion
  repositoryCommit = $gitCommit.Trim()
  format = 'SQL_SPLIT_V1'
  containsSecrets = $true
  encryptedAtRestRequired = $true
}
$metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $metadataPath -Encoding utf8NoBOM

function Invoke-DatabaseDump {
  param(
    [Parameter(Mandatory = $true)][string]$FileName,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  $destination = Join-Path $backupDirectory $FileName
  & npx --no-install supabase db dump --project-ref $ProjectRef --file $destination @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Database dump failed while creating $FileName"
  }
  if (-not (Test-Path -LiteralPath $destination) -or (Get-Item -LiteralPath $destination).Length -eq 0) {
    throw "Database dump is empty: $FileName"
  }
}

Invoke-DatabaseDump -FileName 'roles.sql' -Arguments @('--role-only')
Invoke-DatabaseDump -FileName 'schema.sql' -Arguments @()
Invoke-DatabaseDump -FileName 'data.sql' -Arguments @(
  '--use-copy',
  '--data-only',
  '--exclude', 'storage.buckets_vectors',
  '--exclude', 'storage.vector_indexes'
)
Invoke-DatabaseDump -FileName 'history_schema.sql' -Arguments @('--schema', 'supabase_migrations')
Invoke-DatabaseDump -FileName 'history_data.sql' -Arguments @(
  '--use-copy',
  '--data-only',
  '--schema', 'supabase_migrations'
)

$migrationsDirectory = Join-Path $workspaceRoot 'supabase\migrations'
$migrationFiles = @(Get-ChildItem -LiteralPath $migrationsDirectory -File -Filter '*.sql')
if ($migrationFiles.Count -eq 0) {
  throw 'No versioned migrations were found.'
}
$migrationsArchive = Join-Path $backupDirectory 'migrations.zip'
Compress-Archive -Path (Join-Path $migrationsDirectory '*.sql') -DestinationPath $migrationsArchive

$metadata.status = 'COMPLETE'
$metadata.completedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
$metadata.payloadFileCount = 6
$metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $metadataPath -Encoding utf8NoBOM
Write-BackupManifest -BackupDirectory $backupDirectory

Write-Output "Logical database backup completed: $backupDirectory"
Write-Output 'Encrypt and move this directory to off-site storage immediately.'
