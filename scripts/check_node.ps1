param(
  [string]$Root = 'C:\Codex\Общий'
)

$ErrorActionPreference = 'Stop'
Write-Host "[check_node] Root: $Root"

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Host '[check_node] SKIP: node is not available in PATH.'
  exit 0
}

try {
  & $nodeCmd.Source --version | Out-Null
} catch {
  Write-Host '[check_node] SKIP: node command exists but is not executable in this environment.'
  exit 0
}

$files = Get-ChildItem -Path $Root -Recurse -File -Filter *.mjs | Select-Object -ExpandProperty FullName
if (-not $files) {
  Write-Host '[check_node] No .mjs files found.'
  exit 0
}

$failed = $false
foreach ($f in $files) {
  try {
    & $nodeCmd.Source --check "$f"
    if ($LASTEXITCODE -ne 0) {
      Write-Host "[check_node] FAILED: $f"
      $failed = $true
    }
  } catch {
    Write-Host "[check_node] FAILED (exec error): $f"
    $failed = $true
  }
}

if ($failed) { exit 1 }
Write-Host "[check_node] OK ($($files.Count) files)"
