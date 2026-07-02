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
    (cd "$HOME/.pi" && git pull)
else
    echo -e "\033[1;37mDownloading latest Arete...\033[0m"
    rm -rf "$HOME/.pi/arete_temp"
    git clone https://github.com/asterxsk/arete.git "$HOME/.pi/arete_temp" --quiet
    # rsync -a copies .git (hidden files included), so ~/.pi becomes a proper repo
    rsync -a "$HOME/.pi/arete_temp/" "$HOME/.pi/"
    rm -rf "$HOME/.pi/arete_temp"
fi

# 4. Install pi-web-access
echo -e "\033[1;37mInstalling pi-web-access...\033[0m"
pi install npm:pi-web-access

# 5. Install extension dependencies
echo -e "\033[1;37mInstalling extension dependencies...\033[0m"

# filechanges extension needs 'diff'
FILECHANGES_DIR="$HOME/.pi/agent/extensions/filechanges"
if [ -f "$FILECHANGES_DIR/package.json" ]; then
    echo -e "\033[1;37mInstalling dependencies for filechanges...\033[0m"
    (cd "$FILECHANGES_DIR" && npm install --production)
fi

# pi-hermes-memory extension needs 'better-sqlite3'
HERMES_DIR="$HOME/.pi/agent/extensions/pi-hermes-memory"
if [ -f "$HERMES_DIR/package.json" ]; then
    echo -e "\033[1;37mInstalling dependencies for pi-hermes-memory...\033[0m"
    (cd "$HERMES_DIR" && npm install --production)
fi

echo -e "\033[1;38;5;208mArete installed successfully! Please restart Pi to apply changes.\033[0m"
