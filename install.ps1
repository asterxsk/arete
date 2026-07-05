$esc = [char]0x1b

# ── Colors ──────────────────────────────────────────────
$orange  = "${esc}[38;5;208m"
$bold    = "${esc}[1m"
$dim     = "${esc}[2;37m"
$green   = "${esc}[32m"
$red     = "${esc}[31m"
$gray    = "${esc}[37m"
$reset   = "${esc}[0m"

# ── Logo + header ───────────────────────────────────────
function Write-Logo {
    Clear-Host
    Write-Host "${orange}▝██████████▘${reset}"
    Write-Host "${orange}  ██    ██${reset}"
    Write-Host "${orange}  ██    ██${reset}"
    Write-Host "${orange} ▄██    ██▄${reset}"
    Write-Host ""
    Write-Host "${bold}${orange}Arete v3.5.9${reset}"
    Write-Host ""
}

# ── Bar + status rendering ─────────────────────────────
function Show-ProgressBar {
    param([int]$Step, [int]$Total, [double]$Percent, [string]$Status, [string]$Icon)

    $barWidth = 40
    $filled   = [Math]::Min($barWidth, [Math]::Max(0, [Math]::Floor($barWidth * $Percent / 100)))
    $bar = ("▓" * $filled) + ("▒" * ($barWidth - $filled))

    # progress bar line
    [Console]::SetCursorPosition(0, $script:progLine)
    Write-Host "${esc}[2K Installing ${orange}${bar}${reset} ${bold}$Step/$Total${reset}" -NoNewline

    # status line
    [Console]::SetCursorPosition(0, $script:statLine)
    $prefix = if ($Percent -ge 100) { "${green}${Icon}${reset} " } else { "  " }
    Write-Host "${esc}[2K $prefix${dim}$Status${reset}" -NoNewline
}

# ── Step runner (sync + async) ─────────────────────────
function Invoke-Step {
    param(
        [int]   $Step,
        [int]   $Total,
        [string]$Status,
        [string]$Done,
        [scriptblock]$Action,
        [switch]$Async
    )

    $start  = Get-Date
    $minMs  = 3000
    $job    = $null

    # initial 0 % draw
    Show-ProgressBar -Step $Step -Total $Total -Percent 0 -Status $Status -Icon '○'

    if ($Async) {
        $job = Start-Job -ScriptBlock $Action
    } else {
        & $Action
    }

    # ── animation loop ──────────────────────────────────
    do {
        $elapsed = [Math]::Floor(((Get-Date) - $start).TotalMilliseconds)
        $pct = [Math]::Min(100, [Math]::Floor($elapsed / $minMs * 100))

        $jobDone = $job -eq $null -or $job.State -ne 'Running'
        Show-ProgressBar -Step $Step -Total $Total -Percent $pct -Status $Status -Icon '○'

        if ($jobDone -and $elapsed -ge $minMs) { break }
        Start-Sleep -Milliseconds 50
    } while ($true)

    # finish bar at 100 %
    Show-ProgressBar -Step $Step -Total $Total -Percent 100 -Status $Done -Icon '✔'

    # ── collect job result ──────────────────────────────
    if ($job) {
        $null = Receive-Job -Job $job -Wait -ErrorAction SilentlyContinue 2>&1
        if ($job.State -eq 'Failed') {
            $err = ($job.ChildJobs[0].Error | Out-String).Trim()
            Remove-Job $job -Force
            Show-ProgressBar -Step $Step -Total $Total -Percent 100 -Status "FAILED: $err" -Icon '✖'
            Write-Host ""
            Write-Host "${red}Error in step $Step/${Total}:${reset}"
            Write-Host "$err"
            exit 1
        }
        Remove-Job $job -Force
    }
}

# ═══════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════

[Console]::CursorVisible = $false
Write-Logo

# Cursor-row bookmarks
$script:progLine = [Console]::CursorTop
$script:statLine = $script:progLine + 1
$totalSteps      = 9

try {

    # ── 1/9  Checking system requirements ──────────────
    Invoke-Step -Step 1 -Total $totalSteps `
        -Status "Checking system requirements..." `
        -Done   "System check complete" `
        -Action { }  # passive step

    # ── 2/9  Pi agent ──────────────────────────────────
    $piInstalled = Get-Command pi -ErrorAction SilentlyContinue
    if (-not $piInstalled) {
        Invoke-Step -Step 2 -Total $totalSteps `
            -Status "Pi agent not found. Installing..." `
            -Done   "Pi agent installed" `
            -Action {
                Start-Process powershell -ArgumentList "-NoProfile -Command irm https://pi.dev/install.ps1 | iex" -Wait -WindowStyle Hidden
            } `
            -Async

        # refresh PATH so the rest of the script can see pi
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

        # force a re-check
        if (-not (Get-Command pi -ErrorAction SilentlyContinue)) {
            # Sometimes PATH refresh on WinRT / Win7 needs a nudge
            $env:Path += ";$env:LOCALAPPDATA\pi"
        }
    } else {
        Invoke-Step -Step 2 -Total $totalSteps `
            -Status "Pi agent found, skipping..." `
            -Done   "Pi agent already installed"
    }

    # ── 3/9  Backup agent config ───────────────────────
    if (Test-Path "$HOME\.pi\agent") {
        Invoke-Step -Step 3 -Total $totalSteps `
            -Status "Backing up existing agent to agent.bak..." `
            -Done   "Backup created" `
            -Action {
                $null = robocopy "$HOME\.pi\agent" "$HOME\.pi\agent.bak" /E /XD node_modules /NFL /NDL /NJH /NJS /NC /NS 2>&1
            }
    } else {
        Invoke-Step -Step 3 -Total $totalSteps `
            -Status "No existing agent found, skipping..." `
            -Done   "Backup skipped"
    }

    # ── 4/9  Update Arete ──────────────────────────────
    if (Test-Path "$HOME\.pi\.git") {
        Invoke-Step -Step 4 -Total $totalSteps `
            -Status "Pulling latest Arete updates..." `
            -Done   "Arete repository updated" `
            -Action {
                Push-Location "$HOME\.pi"
                git fetch origin 2>&1 | Out-Null
                $branch = (git rev-parse --abbrev-ref HEAD 2>$null).Trim()
                git reset --hard "origin/$branch" 2>&1 | Out-Null
                Pop-Location
            } `
            -Async
    } else {
        Invoke-Step -Step 4 -Total $totalSteps `
            -Status "Downloading Arete repository..." `
            -Done   "Arete repository cloned" `
            -Action {
                if (Test-Path "$HOME\.pi\arete_temp") { Remove-Item -Path "$HOME\.pi\arete_temp" -Recurse -Force }
                git clone https://github.com/asterxsk/arete.git "$HOME\.pi\arete_temp" --quiet
                $null = robocopy "$HOME\.pi\arete_temp" "$HOME\.pi" /E /NFL /NDL /NJH /NJS /NC /NS | Out-Null
                Remove-Item -Path "$HOME\.pi\arete_temp" -Recurse -Force
            } `
            -Async
    }

    # ── 5/9  pi-web-access ─────────────────────────────
    $pwaDir = "$HOME\.pi\agent\npm\node_modules\pi-web-access"
    if (Test-Path $pwaDir) {
        Invoke-Step -Step 5 -Total $totalSteps `
            -Status "pi-web-access already installed, skipping..." `
            -Done   "pi-web-access already present"
    } else {
        Invoke-Step -Step 5 -Total $totalSteps `
            -Status "Installing pi-web-access..." `
            -Done   "pi-web-access installed" `
            -Action {
                pi install npm:pi-web-access 2>&1 | Out-Null
            } `
            -Async
    }

    # ── 6/9  filechanges deps ──────────────────────────
    $fcDir = "$HOME\.pi\agent\extensions\filechanges"
    if (Test-Path "$fcDir\package.json") {
        if (Test-Path "$fcDir\node_modules") {
            Invoke-Step -Step 6 -Total $totalSteps `
                -Status "filechanges dependencies already installed, skipping..." `
                -Done   "filechanges deps ready"
        } else {
            Invoke-Step -Step 6 -Total $totalSteps `
                -Status "Installing filechanges dependencies (diff)..." `
                -Done   "filechanges deps installed" `
                -Action {
                    Push-Location "$fcDir"
                    npm install --production 2>&1 | Out-Null
                    Pop-Location
                } `
                -Async
        }
    } else {
        Invoke-Step -Step 6 -Total $totalSteps `
            -Status "filechanges extension not found, skipping..." `
            -Done   "filechanges skipped"
    }

    # ── 7/9  pi-hermes-memory deps ─────────────────────
    $hmDir = "$HOME\.pi\agent\extensions\pi-hermes-memory"
    if (Test-Path "$hmDir\package.json") {
        if (Test-Path "$hmDir\node_modules") {
            Invoke-Step -Step 7 -Total $totalSteps `
                -Status "pi-hermes-memory dependencies already installed, skipping..." `
                -Done   "hermes deps ready"
        } else {
            Invoke-Step -Step 7 -Total $totalSteps `
                -Status "Installing pi-hermes-memory dependencies (better-sqlite3)..." `
                -Done   "hermes deps installed" `
                -Action {
                    Push-Location "$hmDir"
                    npm install --production 2>&1 | Out-Null
                    Pop-Location
                } `
                -Async
        }
    } else {
        Invoke-Step -Step 7 -Total $totalSteps `
            -Status "pi-hermes-memory extension not found, skipping..." `
            -Done   "hermes skipped"
    }

    # ── 8/9  artifacts deps ────────────────────────────
    $afDir = "$HOME\.pi\agent\extensions\artifacts"
    if (Test-Path "$afDir\package.json") {
        if (Test-Path "$afDir\node_modules") {
            Invoke-Step -Step 8 -Total $totalSteps `
                -Status "artifacts dependencies already installed, skipping..." `
                -Done   "artifacts deps ready"
        } else {
            Invoke-Step -Step 8 -Total $totalSteps `
                -Status "Installing artifacts dependencies (markdown-it, katex, chart.js, prettier, htmlhint, pico)..." `
                -Done   "artifacts deps installed" `
                -Action {
                    Push-Location "$afDir"
                    npm install --production 2>&1 | Out-Null
                    Pop-Location
                } `
                -Async
        }
    } else {
        Invoke-Step -Step 8 -Total $totalSteps `
            -Status "artifacts extension not found, skipping..." `
            -Done   "artifacts skipped"
    }

    # ── 9/9  Finalize ──────────────────────────────────
    Invoke-Step -Step 9 -Total $totalSteps `
        -Status "Cleaning up temporary files..." `
        -Done   "Installation complete!" `
        -Action {
            if (Test-Path "$HOME\.pi\arete_temp") { Remove-Item -Path "$HOME\.pi\arete_temp" -Recurse -Force }
            if (Test-Path "$HOME\.pi\artifacts_temp") { Remove-Item -Path "$HOME\.pi\artifacts_temp" -Recurse -Force }
        } 

    # ── success ────────────────────────────────────────
    Write-Host ""
    Write-Host "${esc}[2K${green}${bold}  Arete v3.5.9 installed successfully!${reset}"
    Write-Host "${esc}[2K${dim}  Please restart Pi to apply changes.${reset}"
    Write-Host ""

} catch {
    Write-Host ""
    Write-Host "${red}${bold}Installation aborted:${reset} $($_.Exception.Message)"
    exit 1
} finally {
    [Console]::CursorVisible = $true
}
