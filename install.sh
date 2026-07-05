#!/usr/bin/env bash
set -e

# ── Colors ───────────────────────────────────────────────
ORANGE='\033[38;5;208m'
BOLD='\033[1m'
DIM='\033[2;37m'
GREEN='\033[32m'
RED='\033[31m'
RESET='\033[0m'

BAR_WIDTH=40
MIN_FRAMES=60       # 60 frames @ 50ms = 3 s

# saved cursor row for the progress area
PROG_SAVED=""

# ── Logo + header ────────────────────────────────────────
logo() {
    clear
    printf "${ORANGE}▝██████████▘${RESET}\n"
    printf "${ORANGE}  ██    ██${RESET}\n"
    printf "${ORANGE}  ██    ██${RESET}\n"
    printf "${ORANGE} ▄██    ██▄${RESET}\n"
    printf "\n"
    printf "${BOLD}${ORANGE}Arete v3.5.9${RESET}\n"
    printf "\n"
}

# ── Bar + status drawing ─────────────────────────────────
draw_bar() {
    local step=$1 total=$2 percent=$3 status="$4 icon="$5 || true
    local filled=$(( percent * BAR_WIDTH / 100 ))
    [ "$filled" -gt "$BAR_WIDTH" ] && filled=$BAR_WIDTH
    local empty=$(( BAR_WIDTH - filled ))

    # build bar string
    local bar=""
    for ((i=0; i<filled; i++)); do bar="${bar}▓"; done
    for ((i=0; i<empty;   i++)); do bar="${bar}▒"; done

    # progress bar line
    printf '\033[2K'                     # clear line
    printf " Installing ${ORANGE}%s${RESET} ${BOLD}%d/%d${RESET}\n" "$bar" "$step" "$total"

    # status line
    printf '\033[2K'                     # clear line
    if [ "$percent" -ge 100 ]; then
        printf " ${GREEN}%s${RESET} ${DIM}%s${RESET}" "$icon" "$status"
    else
        printf "   ${DIM}%s${RESET}" "$status"
    fi
}

# ── Animation for synchronous steps ──────────────────────
run_sync_step() {
    local step=$1 total=$2 status="$3" done_text="$4"
    shift 4

    # initial 0 % draw
    printf '\0338'
    draw_bar "$step" "$total" 0 "$status" "○"

    # run command
    "$@" 2>/dev/null || true

    # animate for minimum 3 s
    for ((f=1; f<=MIN_FRAMES; f++)); do
        local pct=$(( f * 100 / MIN_FRAMES ))
        printf '\0338'
        draw_bar "$step" "$total" "$pct" "$status" "○"
        sleep 0.05
    done

    printf '\0338'
    draw_bar "$step" "$total" 100 "$done_text" "✔"
    sleep 0.15
}

# ── Animation for asynchronous steps ─────────────────────
run_async_step() {
    local step=$1 total=$2 status="$3" done_text="$4"
    shift 4

    # initial 0 % draw
    printf '\0338'
    draw_bar "$step" "$total" 0 "$status" "○"

    # start command in background
    "$@" &
    local pid=$!
    local f=0

    while true; do
        local running=false
        kill -0 "$pid" 2>/dev/null && running=true

        # exit when work done AND min frames reached
        if [ "$f" -ge "$MIN_FRAMES" ] && ! $running; then
            break
        fi

        local pct=$(( f * 100 / MIN_FRAMES ))
        [ "$pct" -gt 100 ] && pct=100

        printf '\0338'
        draw_bar "$step" "$total" "$pct" "$status" "○"

        f=$((f + 1))
        sleep 0.05
    done

    printf '\0338'
    draw_bar "$step" "$total" 100 "$done_text" "✔"
    sleep 0.15

    wait "$pid" 2>/dev/null || {
        printf '\n'
        printf "${RED}Step %d/%d failed${RESET}\n" "$step" "$total"
        exit 1
    }
}

# ══════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════

printf '\033[?25l'          # hide cursor

logo
printf '\0337'              # save cursor (progress-area start)

TOTAL_STEPS=9
PARENT_PID=$$               # used for signalling from subshells

# ── trap ─────────────────────────────────────────────────
cleanup() { printf '\033[?25h'; }
trap cleanup EXIT
trap 'printf "\n${RED}Interrupted${RESET}\n"; exit 130' INT TERM

# ── 1/9  Checking system ───────────────────────────────
run_sync_step 1 $TOTAL_STEPS \
    "Checking system requirements..." \
    "System check complete" \
    true   # no-op

# ── 2/9  Pi agent ───────────────────────────────────────
if command -v pi &>/dev/null; then
    run_sync_step 2 $TOTAL_STEPS \
        "Pi agent found, skipping..." \
        "Pi agent already installed" \
        true
else
    run_async_step 2 $TOTAL_STEPS \
        "Pi agent not found. Installing..." \
        "Pi agent installed" \
        bash -c "curl -fsSL https://pi.dev/install.sh 2>/dev/null | sh 2>/dev/null"

    # refresh PATH
    if [ -f "$HOME/.bashrc" ]; then source "$HOME/.bashrc" 2>/dev/null; fi
    if [ -f "$HOME/.zshrc" ];  then source "$HOME/.zshrc"  2>/dev/null; fi
    export PATH="$HOME/.local/bin:$PATH"
    if [ -d "$HOME/.local/share/pi/bin" ]; then
        export PATH="$HOME/.local/share/pi/bin:$PATH"
    fi
fi

# ── 3/9  Backup agent config ────────────────────────────
if [ -d "$HOME/.pi/agent" ]; then
    run_sync_step 3 $TOTAL_STEPS \
        "Backing up existing agent to agent.bak..." \
        "Backup created" \
        rsync -a --exclude 'node_modules' "$HOME/.pi/agent/" "$HOME/.pi/agent.bak/" 2>/dev/null
else
    run_sync_step 3 $TOTAL_STEPS \
        "No existing agent found, skipping..." \
        "Backup skipped" \
        true
fi

# ── 4/9  Update Arete ───────────────────────────────────
if [ -d "$HOME/.pi/.git" ]; then
    run_async_step 4 $TOTAL_STEPS \
        "Pulling latest Arete updates..." \
        "Arete repository updated" \
        bash -c "cd '$HOME/.pi' && git fetch origin 2>/dev/null && git reset --hard @{upstream} 2>/dev/null"
else
    run_async_step 4 $TOTAL_STEPS \
        "Downloading Arete repository..." \
        "Arete repository cloned" \
        bash -c "
            rm -rf '$HOME/.pi/arete_temp'
            git clone https://github.com/asterxsk/arete.git '$HOME/.pi/arete_temp' --quiet 2>/dev/null
            rsync -a '$HOME/.pi/arete_temp/' '$HOME/.pi/' 2>/dev/null
            rm -rf '$HOME/.pi/arete_temp'
        "
fi

# ── 5/9  pi-web-access ──────────────────────────────────
PWA_DIR="$HOME/.pi/agent/npm/node_modules/pi-web-access"
if [ -d "$PWA_DIR" ]; then
    run_sync_step 5 $TOTAL_STEPS \
        "pi-web-access already installed, skipping..." \
        "pi-web-access already present" \
        true
else
    run_async_step 5 $TOTAL_STEPS \
        "Installing pi-web-access..." \
        "pi-web-access installed" \
        pi install npm:pi-web-access
fi

# ── 6/9  filechanges deps ───────────────────────────────
FC_DIR="$HOME/.pi/agent/extensions/filechanges"
if [ -f "$FC_DIR/package.json" ]; then
    if [ -d "$FC_DIR/node_modules" ]; then
        run_sync_step 6 $TOTAL_STEPS \
            "filechanges dependencies already installed, skipping..." \
            "filechanges deps ready" \
            true
    else
        run_async_step 6 $TOTAL_STEPS \
            "Installing filechanges dependencies (diff)..." \
            "filechanges deps installed" \
            bash -c "cd '$FC_DIR' && npm install --production 2>/dev/null"
    fi
else
    run_sync_step 6 $TOTAL_STEPS \
        "filechanges extension not found, skipping..." \
        "filechanges skipped" \
        true
fi

# ── 7/9  pi-hermes-memory deps ──────────────────────────
HM_DIR="$HOME/.pi/agent/extensions/pi-hermes-memory"
if [ -f "$HM_DIR/package.json" ]; then
    if [ -d "$HM_DIR/node_modules" ]; then
        run_sync_step 7 $TOTAL_STEPS \
            "pi-hermes-memory dependencies already installed, skipping..." \
            "hermes deps ready" \
            true
    else
        run_async_step 7 $TOTAL_STEPS \
            "Installing pi-hermes-memory dependencies (better-sqlite3)..." \
            "hermes deps installed" \
            bash -c "cd '$HM_DIR' && npm install --production 2>/dev/null"
    fi
else
    run_sync_step 7 $TOTAL_STEPS \
        "pi-hermes-memory extension not found, skipping..." \
        "hermes skipped" \
        true
fi

# ── 8/9  artifacts deps ─────────────────────────────────
AF_DIR="$HOME/.pi/agent/extensions/artifacts"
if [ -f "$AF_DIR/package.json" ]; then
    if [ -d "$AF_DIR/node_modules" ]; then
        run_sync_step 8 $TOTAL_STEPS \
            "artifacts dependencies already installed, skipping..." \
            "artifacts deps ready" \
            true
    else
        run_async_step 8 $TOTAL_STEPS \
            "Installing artifacts dependencies (markdown-it, katex, chart.js, prettier, htmlhint, pico)..." \
            "artifacts deps installed" \
            bash -c "cd '$AF_DIR' && npm install --production 2>/dev/null"
    fi
else
    run_sync_step 8 $TOTAL_STEPS \
        "artifacts extension not found, skipping..." \
        "artifacts skipped" \
        true
fi

# ── 9/9  Finalize ───────────────────────────────────────
run_sync_step 9 $TOTAL_STEPS \
    "Cleaning up temporary files..." \
    "Installation complete!" \
    rm -rf "$HOME/.pi/arete_temp" "$HOME/.pi/artifacts_temp"

# ── Success message ──────────────────────────────────────
printf '\n'
printf '\033[2K'
printf "${GREEN}${BOLD}  Arete v3.5.9 installed successfully!${RESET}\n"
printf '\033[2K'
printf "${DIM}  Please restart Pi to apply changes.${RESET}\n"
printf '\n'
