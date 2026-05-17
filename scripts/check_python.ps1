param(
  [string]$Root = 'C:\Codex\Общий'
)

$ErrorActionPreference = 'Stop'
Write-Host "[check_python] Root: $Root"

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
  Write-Host '[check_python] SKIP: python is not available in PATH.'
  exit 0
}

try {
  & $pythonCmd.Source --version | Out-Null
} catch {
  Write-Host '[check_python] SKIP: python command exists but is not executable in this environment.'
  exit 0
}

$files = Get-ChildItem -Path $Root -Recurse -File -Filter *.py | Select-Object -ExpandProperty FullName
if (-not $files) {
  Write-Host '[check_python] No .py files found.'
  exit 0
}

$failed = $false
foreach ($f in $files) {
  try {
    & $pythonCmd.Source -m py_compile "$f"
    if ($LASTEXITCODE -ne 0) {
      Write-Host "[check_python] FAILED: $f"
      $failed = $true
    }
  } catch {
    Write-Host "[check_python] FAILED (exec error): $f"
    $failed = $true
  }
}

if ($failed) { exit 1 }
Write-Host "[check_python] OK ($($files.Count) files)"
