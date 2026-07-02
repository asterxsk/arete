#!/bin/bash
set -e

echo -e "\033[1;38;5;208mSetting up Arete...\033[0m"

# 1. Check if pi is installed, if not install it
if ! command -v pi &> /dev/null; then
    echo -e "\033[1;37mpi not found. Installing Pi...\033[0m"
    curl -fsSL https://pi.dev/install.sh | sh
    
    # Source the profile to get pi in PATH
    if [ -f "$HOME/.bashrc" ]; then
        source "$HOME/.bashrc"
    elif [ -f "$HOME/.zshrc" ]; then
        source "$HOME/.zshrc"
    fi
fi

# 2. Backup existing agent config (excluding node_modules)
if [ -d "$HOME/.pi/agent" ]; then
    echo -e "\033[1;37mBacking up existing agent to agent.bak...\033[0m"
    rsync -a --exclude 'node_modules' "$HOME/.pi/agent/" "$HOME/.pi/agent.bak/"
fi

# 3. Update Arete — git pull if already a repo, else clone-temp-copy with .git
if [ -d "$HOME/.pi/.git" ]; then
    echo -e "\033[1;37mArete found. Pulling latest updates...\033[0m"
    (cd "$HOME/.pi" && git fetch origin && git reset --hard @{upstream}) || true
else
    echo -e "\033[1;37mDownloading latest Arete...\033[0m"
    rm -rf "$HOME/.pi/arete_temp"
    git clone https://github.com/asterxsk/arete.git "$HOME/.pi/arete_temp" --quiet
    # rsync -a copies .git (hidden files included), so ~/.pi becomes a proper repo
    rsync -a "$HOME/.pi/arete_temp/" "$HOME/.pi/"
    rm -rf "$HOME/.pi/arete_temp"
fi

# 4. Install pi-web-access (skip if already installed)
PI_WEB_ACCESS_DIR="$HOME/.pi/agent/npm/node_modules/pi-web-access"
if [ -d "$PI_WEB_ACCESS_DIR" ]; then
    echo -e "\033[1;37mpi-web-access already installed, skipping...\033[0m"
else
    echo -e "\033[1;37mInstalling pi-web-access...\033[0m"
    pi install npm:pi-web-access
fi

# 5. Install extension dependencies (skip if already installed)
echo -e "\033[1;37mInstalling extension dependencies...\033[0m"

# filechanges extension needs 'diff'
FILECHANGES_DIR="$HOME/.pi/agent/extensions/filechanges"
if [ -f "$FILECHANGES_DIR/package.json" ]; then
    if [ -d "$FILECHANGES_DIR/node_modules" ]; then
        echo -e "\033[1;37m  filechanges dependencies already installed, skipping...\033[0m"
    else
        echo -e "\033[1;37m  Installing dependencies for filechanges...\033[0m"
        (cd "$FILECHANGES_DIR" && npm install --production)
    fi
fi

# pi-hermes-memory extension needs 'better-sqlite3'
HERMES_DIR="$HOME/.pi/agent/extensions/pi-hermes-memory"
if [ -f "$HERMES_DIR/package.json" ]; then
    if [ -d "$HERMES_DIR/node_modules" ]; then
        echo -e "\033[1;37m  pi-hermes-memory dependencies already installed, skipping...\033[0m"
    else
        echo -e "\033[1;37m  Installing dependencies for pi-hermes-memory...\033[0m"
        (cd "$HERMES_DIR" && npm install --production)
    fi
fi

echo -e "\033[1;38;5;208mArete installed successfully! Please restart Pi to apply changes.\033[0m"
