$esc = [char]0x1b

Write-Host "${esc}[1;38;5;208mSetting up Arete...${esc}[0m"

# 1. Check if pi is installed, if not install it
$piInstalled = Get-Command pi -ErrorAction SilentlyContinue
if (-not $piInstalled) {
    Write-Host "${esc}[1;37mpi not found. Installing Pi...${esc}[0m"
    powershell -c "irm https://pi.dev/install.ps1 | iex"
    
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

# 2. Backup existing agent config (excluding node_modules)
if (Test-Path "$HOME\.pi\agent") {
    Write-Host "${esc}[1;37mBacking up existing agent to agent.bak...${esc}[0m"
    robocopy $HOME\.pi\agent $HOME\.pi\agent.bak /E /XD node_modules | Out-Null
}

# 3. Update Arete — git pull if already a repo, else clone-temp-copy
if (Test-Path "$HOME\.pi\.git") {
    Write-Host "${esc}[1;37mArete found. Pulling latest updates...${esc}[0m"
    Push-Location "$HOME\.pi"
    git fetch origin 2>&1 | Out-Null
    git reset --hard @{upstream} 2>&1 | Out-Null
    Pop-Location
} else {
    Write-Host "${esc}[1;37mDownloading latest Arete...${esc}[0m"
    if (Test-Path "$HOME\.pi\arete_temp") {
        Remove-Item -Path "$HOME\.pi\arete_temp" -Recurse -Force
    }
    git clone https://github.com/asterxsk/arete.git "$HOME\.pi\arete_temp" --quiet
    # robocopy /E copies everything including .git, so ~/.pi becomes a proper repo
    robocopy $HOME\.pi\arete_temp $HOME\.pi /E /NFL /NDL /NJH /NJS /NC /NS | Out-Null
    Remove-Item -Path "$HOME\.pi\arete_temp" -Recurse -Force
}

# 4. Install pi-web-access (skip if already installed)
$piWebAccessDir = "$HOME\.pi\agent\npm\node_modules\pi-web-access"
if (Test-Path $piWebAccessDir) {
    Write-Host "${esc}[1;37mpi-web-access already installed, skipping...${esc}[0m"
} else {
    Write-Host "${esc}[1;37mInstalling pi-web-access...${esc}[0m"
    pi install npm:pi-web-access
}

# 5. Install extension dependencies (skip if already installed)
Write-Host "${esc}[1;37mInstalling extension dependencies...${esc}[0m"

# filechanges extension needs 'diff'
$filechangesDir = "$HOME\.pi\agent\extensions\filechanges"
if (Test-Path "$filechangesDir\package.json") {
    if (Test-Path "$filechangesDir\node_modules") {
        Write-Host "${esc}[1;37m  filechanges dependencies already installed, skipping...${esc}[0m"
    } else {
        Write-Host "${esc}[1;37m  Installing dependencies for filechanges...${esc}[0m"
        Push-Location $filechangesDir
        npm install --production
        Pop-Location
    }
}

# pi-hermes-memory extension needs 'better-sqlite3'
$hermesDir = "$HOME\.pi\agent\extensions\pi-hermes-memory"
if (Test-Path "$hermesDir\package.json") {
    if (Test-Path "$hermesDir\node_modules") {
        Write-Host "${esc}[1;37m  pi-hermes-memory dependencies already installed, skipping...${esc}[0m"
    } else {
        Write-Host "${esc}[1;37m  Installing dependencies for pi-hermes-memory...${esc}[0m"
        Push-Location $hermesDir
        npm install --production
        Pop-Location
    }
}

Write-Host "${esc}[1;38;5;208mArete installed successfully! Please restart Pi to apply changes.${esc}[0m"
