# AgentOS Skill Reference — v2026.7.0

AgentOS uses a modular 3-tier ReAct reasoning engine. The AI (Gemini 2.0 Flash / Claude Sonnet 4.6 / GPT-4o / Ollama) automatically discovers, chains, and executes these skills via the Tool Registry and Skill Loader.

---

## Architecture: 3-Tier Ask Engine

Every user query is routed through three escalating tiers:

```
Tier 1: Keyword match → direct tool execution (0 LLM calls, <5ms)
         e.g. "active users", "system stats", "who", "dhcp leases"

Tier 2: Regex rule → action function (0 LLM calls, <5ms)
         e.g. "kick alice", "ping 8.8.8.8", "block 192.168.1.5", "gen voucher 1Day"

Tier 3: LLM ReAct loop (1–5 LLM calls, 500ms–5s)
         System context = memory + skill + lang hint + EmotionEngine tone hint
         Max 5 tool-call turns before forced return
         Dispatches to: manage_network / manage_vouchers /
           manage_finance / manage_mesh / manage_memory / manage_project
```

---

## Tool Registry (32 Built-in Tools)

### Permission Tiers

| Tier | Tools |
|------|-------|
| `read-only` | `system.stats`, `users.active`, `users.all`, `dhcp.leases`, `arp.table`, `interfaces`, `wireless.clients`, `ip.routes`, `voucher.stats`, `voucher.list`, `finance.report`, `finance.trends`, `finance.audit` |
| `workspace-write` (default) | `user.add`, `user.remove`, `user.kick`, `firewall.block`, `firewall.unblock`, `voucher.create`, `ping`, `traceroute`, `dns.flush` |
| `danger-full-access` | `system.reboot`, `system.backup`, `wireless.set_frequency` |

All tools flow through `PermissionPolicy` and `HookRegistry` (`onBefore` / `onAfter` hooks for audit logging, SSE broadcast, and gateway activity push).

---

## Skill Groups

### 1. MikroTik Hotspot Management (`manage_network`)

Full WiFi hotspot lifecycle on MikroTik RouterOS v7.

**User Management:**
- `user.add` — Create hotspot user (profile, password, limit)
- `user.remove` — Delete user
- `user.kick` — Disconnect active session
- `users.active` — List currently connected users
- `users.all` — List all provisioned users

**Network Inspection:**
- `dhcp.leases` — Show DHCP leases
- `arp.table` — Show ARP table
- `interfaces` — List interfaces and status
- `wireless.clients` — List wireless associations
- `ip.routes` — Routing table
- `ping <host>` — Ping test
- `traceroute <host>` — Traceroute
- `dns.flush` — Flush DNS cache

**Firewall:**
- `firewall.block <ip|mac>` — Add drop rule
- `firewall.unblock <ip|mac>` — Remove drop rule

**System:**
- `system.stats` — CPU, RAM, uptime, interfaces
- `system.reboot` — Safe router reboot (**danger-full-access**)
- `system.backup` — Create RouterOS backup (**danger-full-access**)
- `wireless.set_frequency` — Change wireless channel (**danger-full-access**)

**Security Rules:**
- Never expose passwords in responses
- Always confirm destructive actions (kick / remove / reboot)
- All changes logged to rolling audit buffer (last 1,000 events)
- `executeCLI()` rejects shell metacharacters and enforces 4096-char limit

---

### 2. Voucher & Billing System (`manage_vouchers`)

**Plans:**

| Plan | Duration | Price (USD) |
|------|----------|-------------|
| `1hour` | 1 hour | $1.00 |
| `1Day` | 24 hours | $5.00 |
| `7Day` | 7 days | $25.00 |
| `30Day` | 30 days | $80.00 |

**Code format:** `STAR-[A-F0-9]{6}` (e.g., `STAR-4A2F8C`)

**Tools:**
- `voucher.create <plan>` — Create & provision voucher on MikroTik; generates QR code; optionally initiates Mastercard A2A payment
- `voucher.list` — Show active/recent vouchers (limit, used filters)
- `voucher.stats` — Usage and revenue statistics
- `voucher.redeem <code> <user>` — Redeem voucher for user

**Recurring Billing (Auto-Renewal Engine):**
- `guardHotspot` reaper monitors session expiry every 1 hour
- If user has `hasPlan` status and sufficient wallet balance → auto-deduct credits and extend MikroTik session without interruption
- Falls back to expiry + notification if wallet insufficient

**Lifecycle:**
```
createVoucher() → provisioned on MikroTik → QR generated →
customer redeems → session expires →
Auto-Renewal Engine (checks wallet) → renews or kicks →
expireOldVouchers() marks used
```

---

### 3. Financial Engine (`manage_finance`)

**Wallet & Revenue:**
- `finance.report` — Revenue report (all-time summary)
- `finance.trends` — 7-day revenue trend data
- `finance.audit` — Audit trail (last N events)

**Enhanced P2P Credit Transfers:**
Users can transfer credits using identifiers beyond UIDs:
- **Resolvers:** Phone (E.164), Email, or Username
- **Fee Logic:** Configurable via `P2P_FEE_PERCENT` and `P2P_FEE_FLAT` env vars
- **Dual-Entry:** Separate `p2p_transfer_sent` and `p2p_transfer_received` records

**Mastercard A2A Payments:**
- `voucher.payment.initiate` — Initiate Account-to-Account payment for voucher purchase
- `voucher.payment.status <paymentId>` — Check payment status
- Webhook-based reconciliation via `POST /api/webhook/mastercard`
- OAuth 1.0a RSA-SHA256 signing

---

### 4. Project Tracking: CPM + EVM (`manage_project`)

**Critical Path Method (CPM):**
- Forward pass: `ES`, `EF` computed via recursive dependency traversal
- Backward pass: `LS`, `LF`, float
- Critical path: all tasks where `float === 0`

**Earned Value Management (EVM):**

| Metric | Formula |
|--------|---------|
| SPI | EV / PV |
| CPI | EV / AC |
| SV | EV − PV |
| CV | EV − AC |
| ETC | (BAC − EV) / CPI |
| EAC | AC + ETC |
| VAC | BAC − EAC |
| TCPI | (BAC − EV) / (BAC − AC) |

*EVM data sources: voucher revenue as EV/PV; LLM token spend + infra cost as AC.*

**Project Tools (9 actions):**
- `project.create` — Create project with tasks and dependencies
- `project.update` — Update task progress / actuals
- `project.critical_path` — Compute and return critical path
- `project.evm` — Calculate EVM metrics
- `project.report` — Full CPM + EVM summary report
- `project.list` — List all projects
- `project.get <id>` — Get project details
- `project.delete <id>` — Delete project
- `project.export` — Export project data

---

### 5. Agent Memory (`manage_memory`)

Vector + KV memory over Firebase / local backend:

- `memory.store <text>` — Save a memory entry (with embedding)
- `memory.get` — Retrieve all memory entries
- `memory.forget <key>` — Delete a memory entry
- Cosine similarity search for relevant memory retrieval in LLM context

---

### 6. Multi-Router Mesh (`manage_mesh`)

- `nodes.list` — List all registered mesh nodes
- `nodes.register` — Register a new router node
- `nodes.exec <node> <tool>` — Execute tool on a specific node
- `mesh.exec <tool>` — Execute tool across all nodes simultaneously

---

### 7. Messaging Channels

AgentOS supports four unified messaging channels with consistent command dispatch and admin authorization.

**Supported Channels:**
- **Telegram** — Bot API polling, `ALLOWED_CHAT_IDS` allowlist, `/claim` setup wizard
- **WhatsApp** — Baileys socket, JID allowlist, E.164 normalized
- **Slack** — Workspace integration, `/dashboard`, `/stats` commands
- **Discord** — Guild integration, matching command parity

**Public Customer Flow:**
```
Inbound message
  → detectLanguage() [en|es|fr|sw] + classifyIntent() [BUY|FIX|BALANCE|ADMIN|IDLE]
  → EmotionEngine.update()
  → BUY    → sendButtons() with plan selection
  → FIX    → AskEngine.run() → diagnostic reply
  → BALANCE → balance check
  → IDLE   → AskEngine.run() → AI general reply
```

**Admin Commands (all channels):**
```
/setup    → multi-step wizard: IP → user → pass → _finishSetup()
/status   → system + router overview
/voucher  → voucher management
/users    → active users list
/stats    → revenue dashboard
/dashboard → operator dashboard
/doctor   → health check for all 4 channels + Firebase + MikroTik
```

**Security:** Admin command debounce 3s, rate limit 30 req/60s per chatId. All channels share `BaseChannel.isAuthorized()`.

**Cross-Channel Email Identity:**
- Messaging handlers extract email from inbound messages
- Firebase Auth verifies email identity and prevents duplicate records
- Channel-specific IDs (Telegram chatId, WhatsApp JID) mapped to centralized Firebase UIDs
- Authenticated email is the authoritative identity source

---

### 8. EmotionEngine

Per-chat state machine (capped at 10,000 entries):

```
State: { mood: [-1,1], urgency: [0,1], energy: [0.2,1], trust: [-1,1] }

Signals:
  FIX intent     → urgency += 0.4, energy += 0.15
  BUY intent     → mood += 0.05
  Negative words → mood -= 0.15
  Positive words → mood += 0.12, trust += 0.05
  Per message    → energy -= 0.05 (floor 0.2)
  After TTL      → urgency -= 0.3

Tone hints injected into LLM system prompt:
  urgency > 0.6  → "Be concise and direct. Prioritise resolution."
  mood < -0.3    → "Be empathetic and solution-focused."
  trust > 0.7    → "Good rapport. You can be friendly."
```

---

### 9. Self-Audit Engine

Synchronous scan of rolling audit buffer (last 1,000 events):

| Anomaly Type | Condition | Severity |
|---|---|---|
| `rate_anomaly` | Same actor > 10 sensitive actions in 1 hour | High |
| `instant_redeem` | Voucher created and redeemed within 5s by same actor | Medium |

- Scheduled every 6 hours via `AgentOSOrchestrator._scheduleSelfAudit()`
- On-demand via `GET /api/audit/self`
- Violations broadcast to all admin chats and WS gateway

---

### 10. Configuration & Diagnostics

- `config.get <path>` / `config.set <path> <value>` — Read/write config
- `config.show` — Display full CONFIG object
- `doctor` — Run health check across all channels (Telegram, WhatsApp, Slack, Discord), Firebase, MikroTik; auto-fix where possible
- `status` — Quick system + router overview (CPU, RAM, uptime, active sessions)
- `system.monitor` — CPU/RAM threshold alerts every 15s

---

## CLI Commands (REPL + WebSocket)

```
help        status      active      users       kick <u>
voucher <p> vouchers    redeem <c> <u>
ping <h>    logs [n]    dhcp        arp
firewall    block <t>   unblock <t> reboot
adduser     deluser     connect     disconnect
agent <q>   nodes       memory      tools
cli <cmd>   api <path>  audit       clear       exit
```

---

## Cron Schedule (`AgentOSOrchestrator`)

| Job | Schedule | Action |
|-----|----------|--------|
| `daily_reboot` | 04:00 | Router maintenance reboot |
| `heartbeat` | 12:00 | Admin broadcast: system alive |
| Voucher expiry | Every 1h | Mark and notify expired vouchers |
| Self-audit | Every 6h | Scan event log for anomalies |
| New device detection | Every 1m | Alert on unknown MAC addresses |
| System monitor | Every 15s | CPU/RAM threshold alerts |

---

## HTTP API Quick Reference

**Public:**
- `GET /health` — System health, voucher stats, metrics snapshot
- `POST /voucher/redeem` — Redeem voucher (`code`, `user`)
- `GET /voucher/:code/qr` — QR code PNG
- `POST /api/webhook/mastercard` — Mastercard A2A webhook

**Authenticated** (`Authorization: Bearer <GATEWAY_TOKEN>`):
- `GET /api/stats` — Router + DB stats
- `GET /api/vouchers` — List vouchers
- `POST /tool/execute` — Execute any tool by name
- `GET /api/ask/stream` — SSE streaming AI query
- `POST /api/ask` — Single AI query
- `GET /api/audit/self` — On-demand self-audit
- `GET /api/finance/summary` — Revenue summary
- `POST /api/voucher/payment/initiate` — Mastercard A2A initiation
- `GET /api/nodes` / `POST /api/nodes` — Mesh node management

---

## Adding New Skills

New skills can be added by creating files in `skills/` and registering them in the `SkillRegistry`. The Skill Loader discovers `SKILL.md` trigger patterns at startup and matches them during Tier-2 routing.

---

*AgentOS v2026.7.0 — Built for Africa's last-mile operators.*
*Br3eze Africa · github.com/br3ezeafrica*
