
## 8. Setup Script for Easy Installation

**`scripts/install.sh`**
```bash
#!/bin/bash
# AgentOS One-Line Installer

set -e

echo "🤖 Installing AgentOS..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (sudo)"
    exit 1
fi

# Install Node.js if missing
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
fi

# Create user
useradd -r -s /bin/false agentos 2>/dev/null || true

# Setup directory
mkdir -p /opt/agentos
cd /opt/agentos

# Clone repo (or use local files)
if [ -d ".git" ]; then
    git pull
else
    git clone https://github.com/YOUR_USERNAME/agentos.git .
fi

# Install
npm install --production
mkdir -p logs data
chown -R agentos:agentos /opt/agentos

# Setup env if not exists
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "⚠️  Please edit /opt/agentos/.env with your configuration"
    nano .env
fi

# Systemd service
cp scripts/agentos.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable agentos
systemctl start agentos

echo "✅ AgentOS installed!"
echo "🌐 Web interface: http://$(hostname -I | awk '{print $1}'):3000"
echo "📊 Status: systemctl status agentos"