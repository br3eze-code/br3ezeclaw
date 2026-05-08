# Contributing to AgentOS (br3ezeclaw)

Thank you for considering contributing to AgentOS!

## How to Contribute

1. **Fork** the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests where applicable
5. Commit with clear messages
6. Push to your branch and open a **Pull Request**

## Development Setup

```bash
git clone https://github.com/br3eze-code/br3ezeclaw.git
cd br3ezeclaw
npm install
cp .env.example .env
npm run dev

Good First Issues

Add new messaging adapter (Signal, Discord, Slack)
Improve voucher QR code design
Add Prometheus metrics exporter
Write more integration tests
Polish VS Code extension

Code Style

Use ESLint (run npm run lint)
Prefer async/await
Keep skills modular in the skills/ folder
Document new skills in SKILL.md

Adding a New Skill

Create a new file in skills/
Export a function that accepts context and params
Register it in skills/manifest.yaml
Update SKILL.md with description and examples

Questions?
Open an issue or join discussions in the repo.

### 2. Create Folder `docs/` and These Files Inside It

**`docs/install.md`**

```markdown
# Installation Guide

## Prerequisites
- Node.js 20+
- MikroTik RouterOS (v7 recommended)
- Google Gemini API key
- Firebase project (for persistence)

## Quick Install

```bash
git clone https://github.com/br3eze-code/br3ezeclaw.git
cd br3ezeclaw
npm install
cp .env.example .env
# Edit .env with your keys
```
Docker / Podman
```
docker-compose up -d
# or
./setup-podman.sh
```
PowerShell (Windows)
```
.\Setup-AgentOS.ps1
```
Nix
```
nix develop
```
See also: Dockerfile, docker-compose.yml, flake.nix
```

**`docs/telegram.md`**

```markdown
# Telegram Bot Setup

1. Talk to [@BotFather](https://t.me/botfather) on Telegram
2. Create a new bot and copy the token
3. Add the token to your `.env` as `TELEGRAM_BOT_TOKEN`
4. Start the gateway:
```
agentos gateway --telegram
```
See also: Dockerfile, docker-compose.yml, flake.nix

**`docs/telegram.md`**

```markdown
# Telegram Bot Setup

1. Talk to [@BotFather](https://t.me/botfather) on Telegram
2. Create a new bot and copy the token
3. Add the token to your `.env` as `TELEGRAM_BOT_TOKEN`
4. Start the gateway:

```bash
agentos gateway --telegram

Features:

Natural language commands
Inline keyboards for confirmations
Voucher delivery with QR code

**`docs/whatsapp.md`**

```markdown
# WhatsApp Integration (Baileys)

Uses multi-device Baileys library.

1. Set `WHATSAPP_ENABLED=true` in `.env`
2. Run the gateway
3. Scan the QR code from the terminal (first time only)

Supports the same natural language commands as Telegram.
