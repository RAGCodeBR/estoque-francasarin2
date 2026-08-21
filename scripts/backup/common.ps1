Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-SupabasePreflight {
  $commands = @(
    @('--version'),
    @('--help'),
    @('db', '--help')
  )

  foreach ($arguments in $commands) {
    & npx --no-install supabase @arguments *> $null
    if ($LASTEXITCODE -ne 0) {
      throw "Supabase CLI preflight failed: supabase $($arguments -join ' ')"
    }
  }
}

function New-ExternalBackupDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$OutputRoot,
    [Parameter(Mandatory = $true)][string]$Prefix,
    [Parameter(Mandatory = $true)][string]$WorkspaceRoot
  )

  $outputPath = [System.IO.Path]::GetFullPath($OutputRoot)
  $workspacePath = [System.IO.Path]::GetFullPath($WorkspaceRoot).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
  $workspacePrefix = "$workspacePath$([System.IO.Path]::DirectorySeparatorChar)"
  if (
    $outputPath.Equals($workspacePath, [System.StringComparison]::OrdinalIgnoreCase) -or
    $outputPath.StartsWith($workspacePrefix, [System.StringComparison]::OrdinalIgnoreCase)
  ) {
    throw 'Backup output must be outside the repository. Use encrypted external storage.'
  }

  New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
  $timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
  $destination = Join-Path $outputPath "$Prefix-$timestamp"
  if (Test-Path -LiteralPath $destination) {
    throw "Backup destination already exists: $destination"
  }
  New-Item -ItemType Directory -Path $destination | Out-Null
  return $destination
}

function Write-BackupManifest {
  param([Parameter(Mandatory = $true)][string]$BackupDirectory)

  $manifestPath = Join-Path $BackupDirectory 'manifest.sha256.json'
  $items = Get-ChildItem -LiteralPath $BackupDirectory -File -Recurse |
    Where-Object { $_.FullName -ne $manifestPath } |
    Sort-Object FullName |
    ForEach-Object {
      $relativePath = [System.IO.Path]::GetRelativePath($BackupDirectory, $_.FullName)
      $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
      [ordered]@{
        path = $relativePath.Replace([System.IO.Path]::DirectorySeparatorChar, '/')
        sizeBytes = $_.Length
        sha256 = $hash.Hash.ToLowerInvariant()
      }
    }

  $items | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
}
