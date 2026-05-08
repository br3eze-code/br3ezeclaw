#!/bin/bash
# ============================================================
# AgentOS — One-Line Installer
# Usage: sudo bash install.sh

set -euo pipefail

REPO_URL="https://github.com/br3eze-code/br3eze-code.git"
INSTALL_DIR="/opt/agentos"
SERVICE_USER="agentos"
NODE_MAJOR=22

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── Root check ────────────────────────────────────────────────
[ "$EUID" -eq 0 ] || error "Run as root: sudo bash install.sh"

# ── Dependencies ───────────────────────────────────────────────
install_dependencies() {
    info "Checking system dependencies (curl, git, python3, tmux)..."
    apt-get update -yqq
    apt-get install -yqq curl git python3 tmux build-essential
}

# ── Node.js 22 ───────────────────────────────────────────────
install_node() {
    if command -v node >/dev/null 2>&1; then
        current=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
        if [ "$current" -ge "$NODE_MAJOR" ]; then
            info "Node.js $(node --version) already installed"
            return
        fi
        warn "Node.js $current found, upgrading to $NODE_MAJOR..."
    fi
    info "Installing Node.js ${NODE_MAJOR}.x..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
    info "Node.js $(node --version) installed"
}

# ── System user ───────────────────────────────────────────────
create_user() {
    if id "$SERVICE_USER" &>/dev/null; then
        info "User $SERVICE_USER already exists"
    else
        useradd -r -s /bin/false -d "$INSTALL_DIR" "$SERVICE_USER"
        info "Created system user: $SERVICE_USER"
    fi
}

# ── Clone / update repo ───────────────────────────────────────
install_code() {
    mkdir -p "$INSTALL_DIR"
    if [ -d "$INSTALL_DIR/.git" ]; then
        info "Updating existing installation..."
        git -C "$INSTALL_DIR" pull --ff-only
    else
        info "Cloning AgentOS from $REPO_URL..."
        git clone "$REPO_URL" "$INSTALL_DIR"
    fi
    cd "$INSTALL_DIR"
    npm install --omit=dev
    mkdir -p logs data
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
    info "Code installed at $INSTALL_DIR"
}

# ── Environment ───────────────────────────────────────────────
setup_env() {
    if [ ! -f "$INSTALL_DIR/.env" ]; then
        if [ -f "$INSTALL_DIR/.env.example" ]; then
            cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
        else
            touch "$INSTALL_DIR/.env"
            echo "NODE_ENV=production" >> "$INSTALL_DIR/.env"
            echo "PORT=3000" >> "$INSTALL_DIR/.env"
        fi
        chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.env"
        chmod 600 "$INSTALL_DIR/.env"
        warn "Created $INSTALL_DIR/.env — edit it before starting the service:"
        warn "  nano $INSTALL_DIR/.env"
    else
        info ".env already exists — skipping"
    fi
}

# ── Systemd service ───────────────────────────────────────────
install_service() {
    cat > /etc/systemd/system/agentos.service << EOF
[Unit]
Description=AgentOS Network Intelligence Platform
Documentation=https://github.com/br3eze-code/br3ezeclaw
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node bin/agentos.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=agentos
Environment=NODE_ENV=production
EnvironmentFile=-$INSTALL_DIR/.env

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictNamespaces=true
LockPersonality=true
MemoryDenyWriteExecute=true
RestrictRealtime=true
ReadWritePaths=$INSTALL_DIR/logs $INSTALL_DIR/data

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable agentos
    info "Systemd service installed: agentos.service"
}

# ── Firewall ──────────────────────────────────────────────────
open_ports() {
    if command -v ufw >/dev/null 2>&1; then
        ufw allow 3000/tcp comment "AgentOS HTTP" 2>/dev/null || true
        ufw allow 19876/tcp comment "AgentOS WebSocket" 2>/dev/null || true
        info "Firewall: opened ports 3000 and 19876 (ufw)"
    elif command -v firewall-cmd >/dev/null 2>&1; then
        firewall-cmd --permanent --add-port=3000/tcp 2>/dev/null || true
        firewall-cmd --permanent --add-port=19876/tcp 2>/dev/null || true
        firewall-cmd --reload 2>/dev/null || true
        info "Firewall: opened ports 3000 and 19876 (firewalld)"
    else
        warn "No firewall detected — ensure ports 3000 and 19876 are reachable"
    fi
}

# ── Validation ────────────────────────────────────────────────
validate_service() {
    info "Validating service configuration..."
    if ! systemctl cat agentos >/dev/null 2>&1; then
        error "Systemd service is not properly configured."
    fi
    info "Service validation passed."
}

# ── Main ──────────────────────────────────────────────────────
main() {
    echo ""
    echo "  🤖  AgentOS Installer"
    echo "  ─────────────────────────────────────"
    echo ""

    install_dependencies
    install_node
    create_user
    install_code
    setup_env
    install_service
    open_ports
    validate_service

    HOST_IP=$(hostname -I | awk '{print $1}')

    echo ""
    info "✅ AgentOS installed successfully"
    echo ""
    echo "  Next steps:"
    echo "  1. Edit your config:  nano $INSTALL_DIR/.env"
    echo "  2. Start the service: systemctl start agentos"
    echo "  3. Check status:      systemctl status agentos"
    echo "  4. View logs:         journalctl -u agentos -f"
    echo ""
    echo "  Endpoints (once started):"
    echo "    HTTP API:     http://${HOST_IP}:3000"
    echo "    WebSocket:    ws://${HOST_IP}:19876/ws"
    echo "    Health:       http://${HOST_IP}:3000/health"
    echo ""

    if [ ! -f "$INSTALL_DIR/.env" ] || grep -q "YOUR_BOT_TOKEN_HERE" "$INSTALL_DIR/.env" 2>/dev/null; then
        warn "⚠️  Edit $INSTALL_DIR/.env before starting the service!"
    fi
}

main "$@"
