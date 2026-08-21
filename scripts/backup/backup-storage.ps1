[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9]{20}$')][string]$ProjectRef,
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string[]]$Buckets
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
. (Join-Path $PSScriptRoot 'common.ps1')

# Required before every operational Supabase CLI invocation in this script.
Invoke-SupabasePreflight

$normalizedBuckets = $Buckets | ForEach-Object {
  $bucket = $_.Trim()
  if ($bucket -notmatch '^[A-Za-z0-9._-]+$') {
    throw "Invalid bucket name: $bucket"
  }
  $bucket
} | Sort-Object -Unique

$backupDirectory = New-ExternalBackupDirectory -OutputRoot $OutputRoot -Prefix "storage-$ProjectRef" -WorkspaceRoot $workspaceRoot

$objectsDirectory = Join-Path $backupDirectory 'objects'
New-Item -ItemType Directory -Path $objectsDirectory | Out-Null
$listingPath = Join-Path $backupDirectory 'storage-listing.txt'
New-Item -ItemType File -Path $listingPath | Out-Null

foreach ($bucket in $normalizedBuckets) {
  & npx --no-install supabase storage ls --recursive --project-ref $ProjectRef "ss:///$bucket" |
    ForEach-Object { "[$bucket] $_" } |
    Add-Content -LiteralPath $listingPath -Encoding utf8NoBOM
  if ($LASTEXITCODE -ne 0) {
    throw "Storage listing failed for bucket $bucket"
  }

  $bucketDirectory = Join-Path $objectsDirectory $bucket
  New-Item -ItemType Directory -Path $bucketDirectory | Out-Null
  & npx --no-install supabase storage cp --recursive --project-ref $ProjectRef "ss:///$bucket" $bucketDirectory
  if ($LASTEXITCODE -ne 0) {
    throw "Storage download failed for bucket $bucket"
  }
}

$metadata = [ordered]@{
  kind = 'SUPABASE_STORAGE_OBJECTS'
  status = 'COMPLETE'
  createdAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
  projectRef = $ProjectRef
  buckets = $normalizedBuckets
  containsSecrets = $true
  encryptedAtRestRequired = $true
}
$metadata | ConvertTo-Json -Depth 4 |
  Set-Content -LiteralPath (Join-Path $backupDirectory 'backup-metadata.json') -Encoding utf8NoBOM
Write-BackupManifest -BackupDirectory $backupDirectory

Write-Output "Storage object backup completed: $backupDirectory"
Write-Output 'Encrypt and move this directory to off-site storage immediately.'
