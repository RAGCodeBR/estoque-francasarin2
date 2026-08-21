[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$BackupDirectory)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$backupPath = [System.IO.Path]::GetFullPath($BackupDirectory)
$metadataPath = Join-Path $backupPath 'backup-metadata.json'
$manifestPath = Join-Path $backupPath 'manifest.sha256.json'

if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) {
  throw 'backup-metadata.json was not found.'
}
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw 'manifest.sha256.json was not found.'
}

$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
if ($metadata.status -ne 'COMPLETE') {
  throw 'Backup is not marked COMPLETE.'
}
$requiredFiles = switch ($metadata.kind) {
  'SUPABASE_POSTGRES_LOGICAL' {
    @('roles.sql', 'schema.sql', 'data.sql', 'history_schema.sql', 'history_data.sql', 'migrations.zip')
  }
  'SUPABASE_STORAGE_OBJECTS' { @('storage-listing.txt') }
  default { throw "Unsupported backup kind: $($metadata.kind)" }
}

foreach ($fileName in $requiredFiles) {
  $filePath = Join-Path $backupPath $fileName
  if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
    throw "Required backup file is missing: $fileName"
  }
  if ((Get-Item -LiteralPath $filePath).Length -eq 0 -and $fileName -ne 'storage-listing.txt') {
    throw "Required backup file is empty: $fileName"
  }
}

$manifest = @(Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json)
if ($manifest.Count -eq 0) {
  throw 'Backup manifest is empty.'
}
foreach ($entry in $manifest) {
  $entryPath = Join-Path $backupPath ([string]$entry.path)
  $resolvedEntry = [System.IO.Path]::GetFullPath($entryPath)
  $backupPrefix = $backupPath.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
    [System.IO.Path]::DirectorySeparatorChar
  if (-not $resolvedEntry.StartsWith($backupPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Manifest path escapes backup directory: $($entry.path)"
  }
  if (-not (Test-Path -LiteralPath $resolvedEntry -PathType Leaf)) {
    throw "Manifest file is missing: $($entry.path)"
  }
  $actualHash = (Get-FileHash -LiteralPath $resolvedEntry -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne [string]$entry.sha256) {
    throw "SHA-256 mismatch: $($entry.path)"
  }
  if ((Get-Item -LiteralPath $resolvedEntry).Length -ne [long]$entry.sizeBytes) {
    throw "Size mismatch: $($entry.path)"
  }
}

Write-Output "Backup integrity validation passed: $backupPath"
