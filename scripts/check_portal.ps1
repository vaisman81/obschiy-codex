param(
  [string]$PortalDir = 'C:\Codex\Общий\vm_portal'
)

$ErrorActionPreference = 'Stop'
Write-Host "[check_portal] PortalDir: $PortalDir"

$required = @(
  (Join-Path $PortalDir 'server.py'),
  (Join-Path $PortalDir 'public\index.html'),
  (Join-Path $PortalDir 'public\app.js'),
  (Join-Path $PortalDir 'public\styles.css')
)

$missing = @()
foreach ($p in $required) {
  if (-not (Test-Path $p)) { $missing += $p }
}

if ($missing.Count -gt 0) {
  Write-Host '[check_portal] Missing required files:'
  $missing | ForEach-Object { Write-Host " - $_" }
  exit 1
}

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
  Write-Host '[check_portal] SKIP python syntax check: python is not available in PATH.'
  Write-Host '[check_portal] OK (structure only)'
  exit 0
}

try {
  & $pythonCmd.Source --version | Out-Null
} catch {
  Write-Host '[check_portal] SKIP python syntax check: python is not executable in this environment.'
  Write-Host '[check_portal] OK (structure only)'
  exit 0
}

& $pythonCmd.Source -m py_compile (Join-Path $PortalDir 'server.py')
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host '[check_portal] OK (structure + server.py syntax)'
