
<div align="center">
<pre>
█████╗  ██████╗ ███████╗███╗   ██╗████████╗ ██████╗ ███████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██╔═══██╗██╔════╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║   ██║███████╗
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║   ██║╚════██║
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ╚██████╔╝███████║
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ╚══════╝
</pre>
</div>

<p align="center">
  <img src="https://img.shields.io/badge/AgentOS-2026.5.2-blue?style=for-the-badge&logo=router&logoColor=white" alt="Version">
  <img src="https://img.shields.io/badge/MikroTik-RouterOS-green?style=for-the-badge&logo=mikrotik" alt="MikroTik">
  <img src="https://img.shields.io/badge/AI-Gemini%202.5-orange?style=for-the-badge&logo=google" alt="AI">
</p>
<h1 align="center">🤖 AgentOS</h1>
<p align="center"><strong>Network Intelligence Platform — AI-powered MikroTik management via Telegram, WhatsApp & CLI</strong></p>

[![Version](https://img.shields.io/badge/AgentOS-2026.5.2-00d4ff?style=for-the-badge&logo=router&logoColor=white)](https://github.com/br3eze-code/br3eze-code)
[![MikroTik](https://img.shields.io/badge/MikroTik-RouterOS-ff6b00?style=for-the-badge&logo=mikrotik)](https://mikrotik.com)
[![AI](https://img.shields.io/badge/AI-Gemini_2.5-ff9500?style=for-the-badge&logo=google)](https://deepmind.google/gemini)
[![License](https://img.shields.io/badge/License-Apache_2.0-00ff9f?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-ESM-339933?style=for-the-badge&logo=node.js)](https://nodejs.org)
[![Stars](https://img.shields.io/github/stars/br3eze-code/br3eze-code?style=for-the-badge&color=ffd700)](https://github.com/br3eze-code/br3eze-code/stargazers)
 
[**Docs**](docs/) · [**Quick Start**](#quick-start) · [**CLI Reference**](#cli-reference) · [**Architecture**](#architecture) · [**Contributing**](CONTRIBUTING.md)
 

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#documentation">Docs</a> •
  <a href="#demo">Demo</a> •
  <a href="#contributing">Contributing</a>
</p>

---
## ✨ Why AgentOS?

Managing MikroTik routers shouldn't require memorizing CLI commands or keeping WinBox open 24/7. AgentOS brings **conversational AI** to network administration — control your infrastructure through natural language on your favorite messaging platform.

## The Problem AgentOS Solves
Managing community WiFi infrastructure across multiple MikroTik nodes is painful. WinBox requires a desktop. RouterOS CLI requires memorizing commands. Hotspot billing requires manual voucher generation. Payment collection is disconnected from provisioning.
AgentOS collapses this into one intelligent agent you control from Telegram.
```
Before AgentOS:                    After AgentOS:
─────────────────                  ──────────────
Open WinBox          ──┐           Send "kick john"
Navigate menus         │    →      ✅ Done in 2 seconds
Find user              │
Right-click → Kick   ──┘
```
---

## 🚀 Features

<table>
<tr>
<td width="50%">

### 🤖 AI Coordinator
- Natural language router management via Gemini 2.5 Flash
- ReAct reasoning engine with 5-turn depth
- Context-aware command suggestions and error recovery
- AgentMemory for persistent session state

### 💬 Multi-Channel Control
| Channel | Status | Notes |
|---------|--------|-------|
| Telegram Bot | ✅ Production | Inline keyboards, button menus |
| WhatsApp | ✅ Production | Baileys-powered, no Meta API needed |
| WebSocket CLI | ✅ Production | Browser terminal experience |
| REST API | ✅ Production | Programmatic/webhook access |
| RouterOS Native | ✅ Production | On-device Sentinel agent (`.rsc`) |

</td>
<td width="50%">

### 🎫 Voucher System
- Automated WiFi access codes
- **Mastercard A2A** payment integration
- QR code generation
- Wallet-based voucher storage

### 🌐 Network Management

- Multi-router mesh — manage multiple MikroTik nodes from one gateway
- Real-time DHCP/hotspot user monitoring
- Firewall rule management
- Ping, traceroute, bandwidth stats
- Automated alerts via Telegram on threshold breach

### 🔒 Security

- CVE-2026-1526 patched
- Command allowlist (no arbitrary RCE via Telegram)
- HTTPS certificate validation on all outbound calls
- Tiered permission policy (admin / operator / readonly)
- Rate limiting + Joi input validation on all REST endpoints
- Audit trail for all router operations

</td>
</tr>
</table>

---

## 📦 Installation

```bash
#npm installation
npm install -g br3eze-code

or

# Clone repository
git clone https://github.com/br3eze-code/br3ezeclaw.git
cd br3eze-code

# Install dependencies
npm install

# Interactive setup
npm run onboard

# Or manual configuration
cp .env.example .env
# Edit .env with your MikroTik credentials
```
Environment Variables
```
# MikroTik
MIKROTIK_HOST=192.168.88.1
MIKROTIK_USER=admin
MIKROTIK_PASS=your_password
MIKROTIK_PORT=8728

# Telegram
TELEGRAM_TOKEN=your_bot_token
TELEGRAM_ADMIN_CHAT_ID=your_chat_id

# AI
GEMINI_API_KEY=your_gemini_key
ANTROPIC_API_KEY=
OPENAI_API_KEY=

# Payments (Mastercard A2A)
MC_CONSUMER_KEY=your_key
MC_PRIVATE_KEY_PATH=./certs/sandbox.p12

# Database
FIREBASE_PROJECT_ID=your_project
# Or leave blank for local JSON fallback
```

## 🎮 Quick Start

### Prerequisites

- Node.js 20+ (ESM)
- MikroTik RouterOS 7.x
- Telegram Bot Token (from @BotFather)
- Google Gemini API Key(Any LLM Factory)
- Firebase project (or use local JSON fallback)


### CLI Mode
```
# Start interactive CLI
npm start

# Or run specific commands
agentos status                    # Quick overview
agentos network ping 8.8.8.8      # Ping test
agentos users kick john          # Disconnect user
agentos voucher create 1Day      # Generate voucher
```
### Daemon Mode (with Telegram/WhatsApp)
```
# Start gateway
agentos gateway --daemon

# Check status
agentos gateway:status

# View logs
tail -f logs/agentos.log
```
## 📸 Screenshots
<p align="center">
  <img src="docs/images/cli-demo.gif" width="600" alt="CLI Demo">
  <br>
  <em>Interactive CLI with real-time router feedback</em>
</p>
<p align="center">
  <img src="docs/images/telegram-bot.png" width="300" alt="Telegram Bot">
  &nbsp;&nbsp;
  <img src="docs/images/whatsapp-chat.png" width="300" alt="WhatsApp">
  <br>
  <em>Unified messaging interface</em>
</p>

> **AI-powered MikroTik management with multi-channel control via Telegram, WhatsApp, and WebSocket CLI**



## ✨ Features

- 🔥 **AI Coordinator** — Gemini 2.5 ReAct engine for natural language router management
- 💬 **Unified Messaging** — Control via Telegram, WhatsApp, or WebSocket CLI
- 🎫 **Voucher System** — Automated WiFi access codes with Mastercard A2A payments
- 🌐 **Multi-Router Mesh** — Manage multiple MikroTik nodes from one interface
- 📊 **Real-time Monitoring** — System stats, alerts, and financial reporting
- 🔒 **Enterprise Security** — CVE-2026-1526 patched, rate-limited, audit trails

## 🏗️ Architecture
```bash

┌─────────────────────────────────────────────────────────────┐
│                    🤖 AgentOS Gateway                       │
│                  (WebSocket + HTTP API)                     │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Telegram   │  │  WebSocket  │  │   HTTP REST API     │  │
│  │    Channel  │  │   Clients   │  │   (Vouchers/Tools)  │  │
│  │  (Buttons)  │  │  (Dashboard)│  │                     │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                    │             │
│         └────────────────┴────────────────────┘             │
│                          │                                  │
│                   ┌──────▼──────┐                           │
│                   │   Core      │                           │
│                   │   Engine    │                           │
│                   └──────┬──────┘                           │
│                          │                                  │
│         ┌────────────────┼────────────────┐                 │
│         │                │                │                 │
│    ┌────▼────┐    ┌─────▼─────┐    ┌────▼────┐              │
│    │Hotspot  │    │ Database  │    │ Logger  │              │
│    │ Agent   │    │(Firebase/ │    │(Winston)│              │
│    │ (Tools) │    │  Local)   │    │         │              │
│    └────┬────┘    └───────────┘    └─────────┘              │
│         │                                                   │
│    ┌────▼─────────────────────────────────────────┐         │
│    │           🔧 Available Tools                 │         │
│    │  user.add | user.kick | user.status          │         │
│    │  users.active | system.stats | system.logs   │         │
│    │  ping | traceroute | firewall.list | reboot  │         │
│    └──────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  MikroTik Router │
                    │   (192.168.88.1) │
                    └─────────────────┘
```
```bash
                    ┌──────────────────────────────────┐
                    │         Inbound Channels          │
                    │  Telegram │ WhatsApp │ REST │ WS  │
                    └────────────────┬─────────────────┘
                                     │
                    ┌────────────────▼─────────────────┐
                    │           AgentOS Core            │
                    │  ┌──────────────────────────────┐ │
                    │  │     AskEngine (ReAct Loop)   │ │
                    │  │     Gemini 2.5 Flash · 5T    │ │
                    │  └──────────────┬───────────────┘ │
                    │  ┌─────────────▼───────────────┐  │
                    │  │  AgentMemory │ NodeRegistry  │  │
                    │  │  SkillRegistry │ HookRegistry│  │
                    │  └─────────────┬───────────────┘  │
                    └────────────────┼─────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                       │
   ┌──────────▼──────────┐  ┌───────▼────────┐  ┌──────────▼────────┐
   │   MikroTik Manager  │  │    Database    │  │  Payment Gateway  │
   │  routeros-client    │  │  Firebase /    │  │  Mastercard A2A   │
   │  RouterOS API v7    │  │  Local JSON    │  │  OAuth 1.0a RSA   │
   └──────────┬──────────┘  └───────┬────────┘  └───────────────────┘
              │                     │
   ┌──────────▼──────────┐  ┌───────▼────────┐
   │   MikroTik Router   │  │   Firestore    │
   │   192.168.88.1      │  │   Collections  │
   │   + Sentinel .rsc   │  └────────────────┘
   └─────────────────────┘
```
## Repository Structure
```
br3eze-code/
├── agentos.mjs              Main entry (ESM)
├── agentos-sentinel.rsc     RouterOS native agent
├── mikro.rsc                RouterOS bootstrap scripts
├── bin/agentos.js           CLI entry point
├── src/
│   ├── core/
│   │   ├── mikrotik.js      RouterOS manager
│   │   ├── gateway.js       WebSocket server
│   │   ├── database.js      Firebase/local DB
│   │   └── logger.js        Winston logger
│   └── cli/
│       ├── program.js       Commander setup
│       └── commands/        CLI subcommands
├── agents/                  AI agent modules
├── services/                Billing, voucher, payment
├── adapters/                Channel adapters (TG, WA)
├── skills/                  Agent skill definitions
├── workflows/               Automation workflows
├── apps/shared/AgentOSkit/  Shared SDK
├── custom-plugins/          Cordova plugin: aicore
├── vscode-extension/        VS Code extension
├── www/                     Web UI (cyberpunk portal)
├── docs/                    Documentation
├── tests/                   Test suites
└── scripts/                 Deployment scripts
```
## Command Line Interface Tree
```
agentos
├── onboard                   Interactive setup wizard
├── gateway                   WebSocket + Telegram gateway
│   ├── --daemon              Run as background service
│   ├── --force               Kill existing process first
│   └── gateway:stop          Graceful shutdown
├── status (s)                System overview
├── doctor [--fix]            Health check + auto-repair
│
├── network (net)
│   ├── ping <host>           ICMP ping via router
│   ├── scan                  DHCP lease scan
│   ├── firewall              List firewall rules
│   ├── block <ip|mac>        Add drop rule
│   └── unblock <ip|mac>      Remove drop rule
│
├── users (user)
│   ├── list [--all]          Active / all hotspot users
│   ├── kick <username>       Disconnect user
│   ├── add <username>        Create hotspot user
│   ├── remove <username>     Delete user
│   └── status <username>     Check online + usage
│
├── voucher (v)
│   ├── create [plan]         Generate voucher (1Day|7Day|30Day)
│   ├── list                  Recent vouchers
│   ├── revoke <code>         Delete unused voucher
│   └── stats                 Revenue + usage stats
│
└── config
    ├── get <path>            Read config value
    ├── set <path> <value>    Write config value
    ├── edit                  Open in $EDITOR
    └── show                  Display full config
```
## Telegram Commands
```
/start      Authenticate and show menu
/status     Router status overview
/users      Active user list with kick buttons
/kick       Kick a user by name
/voucher    Create voucher with plan selector
/stats      Network + billing stats
/ping       Ping a host
/firewall   Show firewall rules
/help       Full command list
```
## 📖 Full Documentation

- [Installation Guide](docs/install.md)
- [Telegram Setup](docs/telegram.md)
- [WhatsApp Setup](docs/whatsapp.md)
- [API Reference](docs/api.md)
- [Available Skills](SKILL.md)
- [Project Specification](SPEC.md)
- [Getting Started](START_HERE.md)
- [Contributing](CONTRIBUTING.md)

## 🛠️ Tech Stack
| Layer          | Technology                                      |
| -------------- | ----------------------------------------------- |
| **Runtime**    | Node.js 20 ESM                                  |
| **Router API** | MikroTik RouterOS API (routeros-client)         |
| **AI Engine**  | Google Gemini 2.5 Flash (Any Provider)          |
| **Messaging**  | node-telegram-bot-api + @whiskeysockets/baileys |
| **Payments**   | Mastercard A2A · OAuth 1.0a RSA-SHA256          |
| **Database**   | Firebase Firestore / Local JSON                 |
| **Gateway**    | WebSocket (ws) + Express                        |
| **CLI**        | Commander.js                                    |
| **Mobile**     | Apache Cordova (Android/iOS/PWA)                |
| **Security**   | Helmet, Rate-limit, Joi                         |
| **Logging**    | Winston                                         |

## Deployment
### Docker
```bash
docker compose up -d
```
### Podman
```bash
cp agentos.podman.env .env
podman play kube agentos.yaml
```
### Manual (Linux systemd)
```bash
./install.sh
systemctl enable agentos
systemctl start agentos
```
### RouterOS Sentinel
```bash
# Upload via WinBox Files or SCP, then:
/import file-name=agentos-sentinel.rsc
# Verify
/system/scheduler print
```

## 🤝 Contributing
> **We welcome contributions! Please see CONTRIBUTING.md for guidelines.**

### Quick Contributions 
- ⭐ Star this repository
- 🐛 Report bugs via Issues
- 💡 Suggest features via Discussions
- 📖 Improve documentation
- 🔧 Submit PRs for good first issues

## 📜License
Apache 2.0 © 2026 Brighton Mzacana · br3eze.africa

<p align="center">
  <a href="https://github.com/br3eze-code/br3ezeclaw/stargazers">
    <img src="https://img.shields.io/github/stars/br3eze-code/br3ezeclaw?style=social" alt="Stars">
  </a>
  <a href="https://github.com/br3eze-code/br3ezeclaw/network/members">
    <img src="https://img.shields.io/github/forks/br3eze-code/br3ezeclaw?style=social" alt="Forks">
  </a>
</p>
<p align="center">
  <strong>⭐ Star this repo if it helps you manage your network!</strong>
</p>

<div align="center">
<sub>Built for Africa's community networks · Powered by AI · Controlled via Telegram</sub>
</div


