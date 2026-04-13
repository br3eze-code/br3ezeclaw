# Available Skills in AgentOS (br3ezeclaw)

AgentOS uses a modular skill system with ReAct reasoning. The AI (currently Gemini 2.5 Flash) can automatically discover, chain, and execute these skills.

## Core Skills

### MikroTik Hotspot Management (`mikrotik_hotspot`)
- **Description**: Full WiFi hotspot user management on MikroTik RouterOS
- **Tools**:
  - `hotspot.user.add` — Create new user (with profile, password, limit)
  - `hotspot.user.remove` — Delete user
  - `hotspot.user.kick` — Disconnect active user
  - `hotspot.user.list` — List all users
  - `hotspot.active.list` — Show currently connected users

**Security Rules**:
- Never expose passwords
- Always confirm destructive actions (kick/remove)
- All changes logged to audit trail

### Network & System Tools
- `system.stats` — CPU, memory, uptime, interface stats
- `system.logs` — Recent RouterOS logs
- `ping <host>` — Ping test
- `traceroute <host>` — Traceroute
- `firewall.list` — Show firewall rules
- `network.scan` — DHCP lease / ARP scan
- `network.block <ip|mac>` — Block address
- `network.unblock <ip|mac>` — Unblock address
- `reboot` — Safe router reboot (requires confirmation)

### Voucher & Payment System
- `voucher.create <duration>` — e.g. `1Day`, `7Days`, `30Days` (with optional Mastercard A2A payment + QR code)
- `voucher.list` — Show active/recent vouchers
- `voucher.revoke <code>` — Revoke a voucher
- `voucher.stats` — Usage and revenue statistics

### Configuration & Diagnostics
- `config.get <path>` / `config.set <path> <value>`
- `config.show` — Display full config
- `doctor` — Run health check and auto-fix where possible
- `status` — Quick system + router overview

## CLI Commands (Direct Access)
- `agentos users add|kick|list|status`
- `agentos voucher create|list|revoke`
- `agentos network ping|scan|block|unblock`
- `agentos status|doctor|gateway`

New skills can be added by creating files in `src/skills/` and registering them in `manifest.yaml`.

---
