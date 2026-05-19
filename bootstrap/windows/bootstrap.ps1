param(
    [string]$RepoUrl = "https://github.com/vaisman81/obschiy-codex.git",
    [string]$RepoDir = "",
    [string]$Branch = "codex/bootstrap-tools",
    [switch]$SkipInstall,
    [switch]$SkipAuth,
    [switch]$SkipDocker
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-Command {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Add-UserPath {
    param([string]$PathToAdd)
    if (-not (Test-Path $PathToAdd)) {
        return
    }

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $parts = @($userPath -split ";" | Where-Object { $_ })
    if ($parts -notcontains $PathToAdd) {
        [Environment]::SetEnvironmentVariable("Path", (($parts + $PathToAdd) -join ";"), "User")
    }
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")
}

function Install-WingetPackage {
    param(
        [string]$Id,
        [string]$Name
    )

    Write-Host "Installing/checking $Name ($Id)"
    winget install --id $Id -e --accept-source-agreements --accept-package-agreements | Out-Host
}

function Ensure-Repo {
    param(
        [string]$Url,
        [string]$Directory,
        [string]$TargetBranch
    )

    if (-not (Test-Path $Directory)) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $Directory) -Force | Out-Null
        git clone $Url $Directory
    }

    Set-Location $Directory
    if (-not (Test-Path ".git")) {
        throw "$Directory is not a Git repository"
    }

    git fetch origin | Out-Host
    git checkout $TargetBranch | Out-Host
    git pull --ff-only | Out-Host
}

function Ensure-GitHubAuth {
    if ($SkipAuth) {
        Write-Host "Skipping GitHub auth check"
        return
    }

    if (-not (Test-Command gh)) {
        throw "GitHub CLI is not installed"
    }

    gh auth status 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "GitHub CLI is not authenticated. Follow the browser login flow."
        gh auth login
    }
}

function Ensure-PreCommit {
    if (-not (Test-Command pre-commit)) {
        python -m pip install --user pre-commit
        Add-UserPath (Join-Path $env:APPDATA "Python\Python312\Scripts")
    }

    pre-commit install | Out-Host
    pre-commit run --all-files | Out-Host
}

function Ensure-Docker {
    if ($SkipDocker) {
        Write-Host "Skipping Docker check"
        return
    }

    if (-not (Test-Command docker)) {
        throw "Docker CLI is not installed"
    }

    $dockerDesktop = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    if (Test-Path $dockerDesktop) {
        Start-Process -FilePath $dockerDesktop -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 15
    }

    docker info | Out-Host
    docker compose version | Out-Host
    docker run --rm hello-world | Out-Host
}

if (-not $RepoDir) {
    $scriptDir = Split-Path -Parent $PSCommandPath
    $candidateRoot = Resolve-Path (Join-Path $scriptDir "..\..") -ErrorAction SilentlyContinue
    if ($candidateRoot -and (Test-Path (Join-Path $candidateRoot ".git"))) {
        $RepoDir = $candidateRoot.Path
    } else {
        $RepoDir = Join-Path $env:USERPROFILE "Codex\obschiy-codex"
    }
}

Write-Step "Preparing PATH"
Add-UserPath (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312")
Add-UserPath (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\Scripts")
Add-UserPath (Join-Path $env:APPDATA "Python\Python312\Scripts")
Add-UserPath "C:\Program Files\7-Zip"
$hadolintPackage = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages") -Directory -Filter "hadolint.hadolint_*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($hadolintPackage) {
    Add-UserPath $hadolintPackage.FullName
}

if (-not $SkipInstall) {
    Write-Step "Installing developer tools"
    if (-not (Test-Command winget)) {
        throw "winget is required. Install App Installer from Microsoft Store first."
    }

    $packages = @(
        @{ Id = "Git.Git"; Name = "Git" },
        @{ Id = "Python.Python.3.12"; Name = "Python 3.12" },
        @{ Id = "OpenJS.NodeJS.LTS"; Name = "Node.js LTS" },
        @{ Id = "Docker.DockerDesktop"; Name = "Docker Desktop" },
        @{ Id = "GitHub.cli"; Name = "GitHub CLI" },
        @{ Id = "jqlang.jq"; Name = "jq" },
        @{ Id = "MikeFarah.yq"; Name = "yq" },
        @{ Id = "sharkdp.fd"; Name = "fd" },
        @{ Id = "BurntSushi.ripgrep.MSVC"; Name = "ripgrep" },
        @{ Id = "sharkdp.bat"; Name = "bat" },
        @{ Id = "junegunn.fzf"; Name = "fzf" },
        @{ Id = "astral-sh.uv"; Name = "uv" },
        @{ Id = "Casey.Just"; Name = "just" },
        @{ Id = "7zip.7zip"; Name = "7-Zip" },
        @{ Id = "gerardog.gsudo"; Name = "gsudo" },
        @{ Id = "sharkdp.hyperfine"; Name = "hyperfine" },
        @{ Id = "dandavison.delta"; Name = "delta" },
        @{ Id = "chmln.sd"; Name = "sd" },
        @{ Id = "koalaman.shellcheck"; Name = "ShellCheck" },
        @{ Id = "hadolint.hadolint"; Name = "hadolint" },
        @{ Id = "AquaSecurity.Trivy"; Name = "Trivy" }
    )

    foreach ($package in $packages) {
        Install-WingetPackage -Id $package.Id -Name $package.Name
    }
}

Write-Step "Refreshing PATH after installs"
$env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")

Write-Step "Checking core tools"
git --version | Out-Host
python --version | Out-Host
python -m pip --version | Out-Host
node --version | Out-Host
npm --version | Out-Host
docker --version | Out-Host
gh --version | Select-Object -First 1 | Out-Host

Write-Step "Preparing repository"
Ensure-Repo -Url $RepoUrl -Directory $RepoDir -TargetBranch $Branch

Write-Step "Checking GitHub auth"
Ensure-GitHubAuth

Write-Step "Preparing pre-commit"
Ensure-PreCommit

Write-Step "Checking Docker"
Ensure-Docker

Write-Step "Done"
Write-Host "Repository: $RepoDir"
Write-Host "Branch: $Branch"
Write-Host "Run app: docker compose up -d --build"
