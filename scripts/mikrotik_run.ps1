param(
  [Parameter(Mandatory = $true)][string]$Host,
  [int]$Port = 22,
  [Parameter(Mandatory = $true)][string]$User,
  [Parameter(Mandatory = $true)][string]$HostKey,
  [string]$Command = "/system identity print; /system resource print",
  [string]$Password
)

$ErrorActionPreference = 'Stop'
$plink = 'C:\Program Files\PuTTY\plink.exe'
if (-not (Test-Path $plink)) {
  throw "plink not found at $plink"
}

if (-not $Password) {
  $Password = $env:MIKROTIK_PASSWORD
}
if (-not $Password) {
  throw 'Password is required. Pass -Password or set MIKROTIK_PASSWORD env var.'
}

& $plink -batch -ssh -P $Port -l $User -pw $Password -hostkey $HostKey $Host $Command
if ($LASTEXITCODE -ne 0) {
  throw "MikroTik command failed with exit code $LASTEXITCODE"
}
