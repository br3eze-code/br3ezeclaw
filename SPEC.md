# AgentOS — Technical Specification & Feasibility Study

**Version:** 2026.7.0  
**Classification:** Internal / Engineering  
**Date:** 2026-04-09  
**Author:** Br3eze Africa  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Architecture](#3-architecture)
4. [Feature Specification](#4-feature-specification)
5. [API Reference](#5-api-reference)
6. [Security Model](#6-security-model)
7. [Data Model](#7-data-model)
8. [Deployment](#8-deployment)
9. [Feasibility Study](#9-feasibility-study)
10. [Risk Register](#10-risk-register)
11. [Roadmap](#11-roadmap)

---

## 1. Executive Summary

AgentOS is a Node.js network intelligence platform purpose-built for community WiFi operators in Africa. It combines MikroTik RouterOS management, multi-LLM AI reasoning, multilingual messaging (Telegram + WhatsApp), real-time WebSocket control, voucher billing, and Mastercard A2A payment processing into a single deployable unit.

The platform targets operators running group Starlink subscriptions across shared community networks — a growing segment in sub-Saharan Africa where last-mile connectivity is expensive and management tooling is scarce.

**Key capabilities at v2026.7.0:**

- 3-tier AI reasoning engine (keyword → rule → LLM ReAct loop) with Gemini, Claude, OpenAI, and Ollama support
- MikroTik hotspot lifecycle management (user provisioning, session control, firewall, DNS)
- Unified Telegram + WhatsApp bot with multilingual intent routing (EN / ES / FR / SW)
- Per-user EmotionEngine for context-aware AI tone
- Voucher system with QR codes, wallet management, and Mastercard A2A payment initiation
- WebSocket CLI for browser-based terminal access
- CPM (Critical Path Method) + EVM (Earned Value Management) project tracking engine
- Self-audit anomaly detection on the event log
- Firebase and local JSON backends

---

## 2. System Overview

### 2.1 Problem Statement

Community WiFi operators in Africa face three compounding problems:

1. **Management complexity** — MikroTik RouterOS is powerful but requires CLI expertise most operators do not have. Remote support is expensive and slow.
2. **Customer friction** — Customers purchase vouchers through informal channels (WhatsApp messages, phone calls), creating manual overhead and errors.
3. **Financial opacity** — Revenue tracking, expiry management, and payment reconciliation are done in spreadsheets or not at all.

### 2.2 Solution

AgentOS collapses these three problems into one always-on intelligent agent that operators and customers interact with through Telegram or WhatsApp in their native language.

```
                    ┌─────────────────────────────────────────┐
                    │              AgentOS Daemon              │
  Telegram  ───────►│                                         │
  WhatsApp  ───────►│  ┌──────────┐   ┌───────────────────┐  │
  WebSocket ───────►│  │ Ask      │   │  MikroTik         │  │
  REST/SSE  ───────►│  │ Engine   │──►│  RouterOS         │  │
                    │  │ 3-Tier   │   │  Adapter          │  │
                    │  └────┬─────┘   └────────┬──────────┘  │
                    │       │                   │             │
                    │  ┌────▼─────┐   ┌────────▼──────────┐  │
                    │  │  LLM     │   │  Database         │  │
                    │  │ Adapter  │   │  Firebase/Local   │  │
                    │  │ (multi)  │   └───────────────────┘  │
                    │  └──────────┘                          │
                    └─────────────────────────────────────────┘
```

### 2.3 Scope

**In scope (v2026.7.0):**

- MikroTik RouterOS v7 via `routeros-client` API
- Telegram Bot API (polling mode)
- WhatsApp via `@whiskeysockets/baileys`
- Gemini 2.0 Flash, Claude Sonnet 4.6, GPT-4o, Ollama (local)
- Firebase Firestore and local JSON backends
- Mastercard Account-to-Account Commerce API
- Multi-router mesh (NodeRegistry)
- CPM + EVM project tracking

**Out of scope:**

- Android/iOS mobile applications
- Multi-tenancy (single operator instance)
- OpenWRT, pfSense, or Ubiquiti integration (MikroTik only)
- Billing integrations beyond Mastercard A2A

---

## 3. Architecture

### 3.1 Component Map

```
§1  ENV Schema          — Joi validation, all config at startup
§2  Config              — Structured CONFIG object, no magic strings
§3  Logger              — Winston, file + console transports
§4  Utilities           — fmtBytes, fmtUptime, truncate, detectLanguage, classifyIntent
§5  Metrics & CostTracker — Runtime counters, LLM token spend
§6  LLM Adapter Layer   — GeminiAdapter, ClaudeAdapter, OpenAIAdapter, OllamaAdapter
§7  Data Layer          — Database class (Firebase + local), cosine similarity
§8  Agent Memory        — Vector + KV memory over Database
§9  Financial Controller — Revenue reports, trends, Mastercard A2A service
§10 OS Adapter Layer    — OSAdapter base, MikroTikAdapter, LinuxSSHAdapter (stub)
§11 Tool Registry       — PermissionPolicy, HookRegistry, ToolRegistry (32 builtins)
§12 Skill Loader        — SKILL.md discovery, trigger matching
§13 Conversation Session — Message history, compaction, persistence
§14 Node Registry       — Multi-router mesh management
§15 EmotionEngine       — Per-chat mood/urgency/trust/energy state machine
§16 Ask Engine          — 3-tier ReAct loop, language detection, intent classification
§17 WhatsApp Service    — Baileys socket wrapper
§18 Unified Messaging   — Platform-agnostic send/receive/broadcast
§19 Chat Rate Limiter   — Per-chatId sliding window
§20 Agent Bot           — Public portal, admin commands, emotion routing
§21 WebSocket CLI       — Interactive terminal over WebSocket
§22 WebSocket Gateway   — Auth, heartbeat, tool invocation, CLI sessions
§23 System Monitor      — CPU / RAM threshold alerts
§24 Orchestrator        — Cron, provisioning, device detection, voucher expiry, self-audit
§25 Express Application — REST API, SSE, payment webhooks
§26 Bootstrap           — Singleton wiring
§27 REPL CLI            — readline interactive shell (node index.js cli)
§28 Entry Point         — Daemon vs CLI dispatch
```

### 3.2 3-Tier Ask Engine

Every user query passes through three escalating tiers. Higher tiers only activate if lower tiers produce no match.

```
Input
  │
  ├─ Tier 1: Keyword match → direct tool execution (0 LLM calls, <5ms)
  │    "active users", "system stats", "who", "dhcp leases"
  │
  ├─ Tier 2: Regex rule → action function (0 LLM calls, <5ms)
  │    "kick alice", "ping 8.8.8.8", "block 192.168.1.5", "gen voucher 1Day"
  │
  └─ Tier 3: LLM ReAct loop (1-5 LLM calls, 500ms–5s)
       System context = memory + skill + lang hint + emotion tone hint
       Max 5 tool-call turns before forced return
       Tool calls dispatch to: manage_network / manage_vouchers /
         manage_finance / manage_mesh / manage_memory
```

### 3.3 Multilingual Pipeline

```
Input text
    │
    ▼
detectLanguage()      ← lightweight regex scoring (no external deps)
    │ lang: en|es|fr|sw
    ▼
classifyIntent()      ← keyword matching per language
    │ intent: BUY|FIX|BALANCE|ADMIN|IDLE
    ▼
EmotionEngine.update()  ← mood/urgency/trust/energy update
    │ toneHint: string injected into LLM system prompt
    ▼
AskEngine.run()       ← tier routing with lang + intent context
    │
    ▼
Multilingual response routing in AgentOSBot._publicPortal()
```

### 3.4 Cron Architecture (`AgentOSOrchestrator`)

All scheduled jobs use `_cronFire(jobKey, hour, minute, fn)` — a drift-safe helper that fires once per calendar day per job, regardless of interval jitter.

| Job | Schedule | Action |
|-----|----------|--------|
| `daily_reboot` | 04:00 | Router maintenance reboot |
| `heartbeat` | 12:00 | Admin broadcast: system alive |
| Voucher expiry | Every 1h | Mark and notify expired vouchers |
| Self-audit | Every 6h | Scan event log for anomalies |
| New device detection | Every 1m | Alert on unknown MAC addresses |
| System monitor | Every 15s | CPU/RAM threshold alerts |

---

## 4. Feature Specification

### 4.1 Voucher System

**Plans:**

| Plan | Duration | Data Limit | Price (USD) |
|------|----------|------------|-------------|
| 1hour | 1 hour | Router profile | $1.00 |
| 1Day | 24 hours | Router profile | $5.00 |
| 7Day | 7 days | Router profile | $25.00 |
| 30Day | 30 days | Router profile | $80.00 |

**Lifecycle:**

```
createVoucher() → provisioned on MikroTik → QR code generated →
customer scans / uses code → redeemVoucher() → session expires →
expireOldVouchers() marks used
```

**Code format:** `STAR-[A-F0-9]{6}` (e.g., `STAR-4A2F8C`)  
**Generation:** `crypto.randomBytes(3).toString('hex').toUpperCase()`

**Dual expiry model:** Sessions expire at whichever comes first — the `expiresAt` timestamp or the MikroTik profile's `limit-bytes-total`.

### 4.2 Tool Registry

32 built-in tools registered at startup. All tools flow through `PermissionPolicy` and `HookRegistry`.

**Permission tiers:**

| Tier | Tools |
|------|-------|
| `read-only` | `system.stats`, `users.active`, `users.all`, `dhcp.leases`, `arp.table`, `interfaces`, `wireless.clients`, `ip.routes`, `voucher.stats`, `voucher.list`, `finance.report`, `finance.trends`, `finance.audit` |
| `workspace-write` (default) | `user.add`, `user.remove`, `user.kick`, `firewall.block`, `firewall.unblock`, `voucher.create`, `ping`, `traceroute`, `dns.flush` |
| `danger-full-access` | `system.reboot`, `system.backup`, `wireless.set_frequency` |

**Hook points:** `onBefore` and `onAfter` for audit logging, SSE broadcast, and gateway activity push.

### 4.3 EmotionEngine

Per-chat state machine, one instance per unique `chatId` (capped at 10,000 entries).

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

### 4.4 Self-Audit Engine

Synchronous scan of the in-memory rolling audit buffer (last 1,000 events, populated regardless of Firebase/local backend).

**Anomaly patterns detected:**

| Type | Condition | Severity |
|------|-----------|----------|
| `rate_anomaly` | Same actor performs >10 sensitive actions in 1 hour | High |
| `instant_redeem` | Voucher created and redeemed within 5 seconds by same actor | Medium |

Scheduled every 6 hours via `AgentOSOrchestrator._scheduleSelfAudit()`. Violations broadcast to all admin chats and WS gateway.

### 4.5 CPM + EVM Engine (`ProjectManager`)

**Critical Path Method:**

- Forward pass: `ES`, `EF` computed via recursive dependency traversal
- Backward pass: `LS`, `LF`, float
- Critical path: all tasks where `float === 0`

**Earned Value Management:**

| Metric | Formula |
|--------|---------|
| SPI (Schedule) | EV / PV |
| CPI (Cost) | EV / AC |
| SV | EV − PV |
| CV | EV − AC |
| ETC | (BAC − EV) / CPI |
| EAC | AC + ETC |
| VAC | BAC − EAC |
| TCPI | (BAC − EV) / (BAC − AC) |

**EVM data sources:** voucher revenue as EV/PV, LLM token spend + infra cost as AC.

### 4.6 Messaging Flows

**Public customer flow:**

```
Inbound message
  → detectLanguage() + classifyIntent()
  → EmotionEngine.update()
  → BUY  → sendButtons() with plan selection
  → FIX  → AskEngine.run() → diagnostic reply
  → BALANCE → balance check message
  → IDLE → AskEngine.run() → AI general reply
```

**Admin command flow (Telegram / WhatsApp):**

```
/command [args]
  → _onCommand() debounce 3s per chatId+command
  → ADMIN_ONLY check
  → dispatch to handler
  → reply
```

**Setup wizard (multi-step):**

```
/setup → prompt IP → prompt user → prompt pass → _finishSetup()
```

---

## 5. API Reference

### 5.1 HTTP Endpoints

All authenticated endpoints require `Authorization: Bearer <GATEWAY_TOKEN>`.

**Public:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | System health, voucher stats, metrics snapshot |
| POST | `/voucher/redeem` | Redeem a voucher code (`code`, `user`) |
| GET | `/voucher/:code/qr` | QR code PNG data URL for a voucher |
| GET | `/api/voucher/payment/status/:paymentId` | Mastercard payment status |
| POST | `/api/webhook/mastercard` | Mastercard A2A webhook receiver |

**Authenticated:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats` | Router + DB stats + metrics |
| GET | `/api/vouchers` | List vouchers (limit, used filters) |
| POST | `/tool/execute` | Execute any registered tool by name |
| GET | `/api/stream` | SSE event stream |
| GET | `/api/ask/stream` | SSE streaming AI query (`?q=`) |
| POST | `/api/ask` | Single AI query |
| GET | `/api/session/:id` | Load conversation session |
| GET | `/api/trends` | 7-day revenue trend data |
| GET | `/api/audit` | Audit trail (last N events) |
| GET | `/api/audit/self` | Run self-audit scan |
| GET | `/api/nodes` | List mesh nodes |
| POST | `/api/nodes` | Register a mesh node |
| POST | `/api/nodes/:name/exec` | Execute tool on specific node |
| GET | `/api/mesh/exec` | Execute tool on all nodes |
| GET | `/api/memory` | Get all agent memory |
| POST | `/api/memory` | Store a memory entry |
| DELETE | `/api/memory/:key` | Forget a memory entry |
| GET | `/api/finance/summary` | Revenue summary report |
| POST | `/api/voucher/payment/initiate` | Initiate Mastercard A2A payment |

### 5.2 WebSocket Protocol

**Connection:** `ws://host:GATEWAY_PORT/ws?token=<GATEWAY_TOKEN>`

**Client → Server:**

| Type | Payload | Description |
|------|---------|-------------|
| `pong` | — | Heartbeat response |
| `discover` | — | List available tools |
| `call` | `{ tool, params, id }` | Execute a tool |
| `tool.invoke` | `{ tool, params, id }` | Execute tool (alternate format) |
| `status` | — | Runtime status |
| `cli.start` | — | Start interactive CLI session |
| `cli.input` | `{ input }` | Send keystrokes to CLI |
| `cli.exec` | `{ command, id }` | One-shot command execution |
| `cli.stop` | — | End CLI session |
| `cli.resize` | `{ cols, rows }` | Terminal resize |

**Server → Client:**

| Type | Payload |
|------|---------|
| `hello` | `{ service, version, timestamp, llm, os }` |
| `ping` | `{ timestamp }` |
| `result` | `{ id, data }` |
| `tool.result` | `{ id, result, success }` |
| `tool.error` | `{ id, error, success }` |
| `tools` | `{ list }` |
| `status` | `{ mikrotik, clients, cliSessions, llm, os }` |
| `broadcast` | `{ payload }` |
| `ai.state` | `{ state: 'thinking'|'idle' }` |
| `activity` | `{ source, action, timestamp }` |
| `cli.started` | `{ message }` |
| `cli.output` | Various sub-types: `text`, `table`, `list`, `code`, `error`, `success`, `prompt`, `thinking`, `ai_response`, `confirm`, `clear` |
| `cli.stopped` | `{ message }` |
| `audit.violations` | `{ report }` |
| `vouchers.expired` | `{ count }` |

### 5.3 CLI Commands (REPL + WebSocket)

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

## 6. Security Model

### 6.1 Authentication

- **HTTP API:** Timing-safe Bearer token comparison (`crypto.timingSafeEqual`)
- **WebSocket:** Token in query param or `X-AgentOS-Token` header, same comparison
- **Token source:** `AGENTOS_GATEWAY_TOKEN` env var, or auto-generated 32-byte hex on each start
- **Telegram:** `ALLOWED_CHAT_IDS` allowlist; setup mode (`/claim`) if empty
- **WhatsApp:** JID allowlist, normalized to E.164 format

### 6.2 Rate Limiting

| Layer | Limit | Window |
|-------|-------|--------|
| Express global | 100 req | 15 min |
| Voucher purchase | 5 req | 60 sec per chatId |
| Admin command debounce | 1 req | 3 sec per chatId+command |
| Admin command rate | 30 req | 60 sec per chatId |

### 6.3 Prompt Injection Filter

All AI inputs screened for: `ignore.*instructions`, `act as`, `system prompt`, `jailbreak`. Blocked responses return tier-0 `blocked` type — no LLM call made.

### 6.4 RouterOS CLI Hardening

`executeCLI()` rejects commands containing `` ` $ ( ) { } | ; & < > `` and enforces a 4096-character limit. Scripts are executed via `/system/script` upsert-and-run, then immediately deleted in the `finally` block.

### 6.5 Self-Audit

Runs on a 6-hour schedule and on-demand. Detects sensitive action bursts and instant voucher abuse. Findings broadcast to all admin channels and the WS gateway.

---

## 7. Data Model

### 7.1 Voucher Record

```json
{
  "id":         "STAR-4A2F8C",
  "code":       "STAR-4A2F8C",
  "plan":       "1Day",
  "createdAt":  "2026-04-09T10:00:00.000Z",
  "expiresAt":  "2026-04-10T10:00:00.000Z",
  "used":       false,
  "redeemedAt": null,
  "redeemedBy": null,
  "createdBy":  "portal:telegram:123456789",
  "actor":      "123456789",
  "paymentId":  null,
  "paymentStatus": null
}
```

### 7.2 Audit Entry

```json
{
  "actor":     "123456789",
  "action":    "user.kick",
  "details":   { "args": { "username": "alice" } },
  "timestamp": "2026-04-09T11:30:00.000Z"
}
```

### 7.3 Agent Memory Entry

```json
{
  "text":      "Operator prefers reboot at 4am, not 3am",
  "embedding": [0.123, -0.456, ...],
  "updatedAt": "2026-04-09T09:00:00.000Z"
}
```

### 7.4 Conversation Session

Stored in `data/sessions/<uuid>.json`:

```json
{
  "sessionId": "uuid-v4",
  "messages":  [
    { "role": "user",      "content": "how many active users?" },
    { "role": "assistant", "content": "There are currently 14 active sessions." }
  ],
  "savedAt": "2026-04-09T12:00:00.000Z"
}
```

Session compaction triggers at ~150,000 token estimate (600KB): keeps first message and last 8.

---

## 8. Deployment

### 8.1 Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| Node.js | v20 LTS | v22 LTS |
| RAM | 512 MB | 1 GB |
| Storage | 2 GB | 8 GB |
| OS | Ubuntu 22.04 | Ubuntu 24.04 |
| Network | LAN access to MikroTik API port 8728 | Static IP |

### 8.2 Environment Variables

**Required:**

```
MIKROTIK_PASS=<router-admin-password>
```

**Key optional:**

```
MIKROTIK_IP=192.168.88.1          # Router IP
MIKROTIK_PORT=8728                 # API port

LLM_PROVIDER=gemini               # gemini|claude|openai|ollama
GEMINI_API_KEY=...
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...

DATA_BACKEND=local                 # local|firebase
FIREBASE_PROJECT_ID=...
FIREBASE_PRIVATE_KEY=...
FIREBASE_CLIENT_EMAIL=...

TELEGRAM_TOKEN=...
ALLOWED_CHAT_IDS=123456,789012     # comma-separated
WHATSAPP_ENABLED=true
WHATSAPP_AUTH_DIR=./data/whatsapp_auth

PORT=3000
GATEWAY_PORT=19876
AGENTOS_GATEWAY_TOKEN=...          # auto-generated if blank

EMOTION_ENABLED=true
DEFAULT_LANGUAGE=en                # en|es|fr|sw
```

### 8.3 Startup Modes

```bash
# Daemon (full platform)
node index.js

# Interactive CLI REPL
node index.js cli

# One-shot CLI query
node index.js cli "how many active users?"
```

### 8.4 Process Management (systemd)

```ini
[Unit]
Description=AgentOS Network Intelligence Platform
After=network.target

[Service]
Type=simple
User=agentos
WorkingDirectory=/opt/agentos
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

---

## 9. Feasibility Study

### 9.1 Technical Feasibility

**Assessment: HIGH**

The entire platform runs on a single Node.js process with no microservice dependencies. All third-party services (MikroTik API, Telegram Bot API, Baileys, Firebase, LLM providers) are accessed over HTTP/TCP from standard npm packages with well-established community support.

**Dependency risk matrix:**

| Dependency | Maturity | Alternatives | Risk |
|------------|----------|--------------|------|
| `routeros-client` | Stable, community-maintained | `node-routeros` | Low |
| `node-telegram-bot-api` | Mature, 7k+ stars | `telegraf` | Low |
| `@whiskeysockets/baileys` | Active, frequently updated | `whatsapp-web.js` | Medium — WhatsApp ToS ambiguity |
| Firebase Admin SDK | Google-backed, stable | Supabase, PocketBase | Low |
| `@google/generative-ai` | Google-backed | Multiple LLMs | Low |
| Winston | Mature logging standard | pino | Low |

**Known technical constraints:**

- WhatsApp Baileys uses unofficial reverse-engineered protocol. Meta may break it without notice. Mitigation: official WhatsApp Business API as upgrade path.
- MikroTik API (port 8728) must be accessible from the host. Firewall or NAT may block it in some deployments.
- `selfAudit()` operates on in-memory rolling buffer (last 1,000 events). Long-lived Firebase deployments with high event volumes will have gaps in audit history before the in-memory buffer was introduced (fixed in v2026.7.0).

### 9.2 Operational Feasibility

**Assessment: HIGH for experienced operators, MEDIUM for new operators**

**Operator profile fit:**

- The target operator has MikroTik experience (required to run RouterOS)
- Telegram/WhatsApp familiarity is universal in the target market
- The `/claim` setup mode allows zero-configuration admin onboarding
- The AI tier-3 fallback means operators can ask questions in plain English/Swahili without knowing commands

**Support requirements:**

- Initial deployment: 30–60 minutes (Node.js install, `.env` config, systemd setup)
- Ongoing: near-zero for normal operations; AI handles most queries automatically
- MikroTik credential changes require `MIKROTIK_PASS` env update and service restart

**Multilingual coverage:**

- EN, ES, FR, SW covered via lightweight regex scoring
- Swahili coverage is intentionally prioritised for East Africa deployments
- Language detection is heuristic only — mixed-language messages default to `DEFAULT_LANGUAGE`

### 9.3 Financial Feasibility

**Revenue model for operator:**

| Plan | Price | MikroTik overhead | Net margin |
|------|-------|-------------------|------------|
| 1 Hour | $1.00 | ~$0.01 | ~99% |
| 1 Day | $5.00 | ~$0.05 | ~99% |
| 7 Day | $25.00 | ~$0.25 | ~99% |
| 30 Day | $80.00 | ~$0.80 | ~99% |

*MikroTik overhead = Starlink share + power + maintenance amortized per voucher.*

**AgentOS operating cost (per deployment):**

| Component | Monthly cost (USD) |
|-----------|-------------------|
| VPS (2 vCPU, 2GB RAM) | $5–12 |
| Gemini Flash LLM (typical usage) | $0.50–3.00 |
| Firebase Spark (free tier) | $0 |
| Firebase Blaze (high volume) | $1–10 |
| **Total** | **$6–25/month** |

**Break-even analysis:**  
At $5/day plan: operator needs to sell **2 daily vouchers/month** to cover AgentOS running costs. Virtually any active deployment exceeds this in the first week.

**EVM integration value:**  
The CPM+EVM engine allows operators to track voucher sales against planned targets, identify schedule slippage, and generate client-ready reports — capability previously only available to enterprise ISPs.

### 9.4 Market Feasibility

**Target market:** Sub-Saharan Africa community WiFi operators  
**Addressable operators:** Estimated 50,000–200,000 active Starlink resellers and community network operators across Africa (2026)  
**Competitive landscape:** No direct equivalent exists. Alternatives are:

- Manual MikroTik CLI management (dominant, no AI/bot)
- Mikrobill / ISPmanager (enterprise, expensive, no AI, no Africa localisation)
- Custom PHP billing systems (fragile, no RouterOS AI integration)

**Differentiation:**

- Only platform combining RouterOS management + AI + multilingual WhatsApp/Telegram
- Swahili-first intent routing (no competitor targets this)
- Runs on a $5/month VPS — no enterprise pricing

### 9.5 Regulatory Feasibility

**Assessment: LOW RISK**

- No personal data is stored beyond Telegram/WhatsApp chat IDs and transaction records
- Mastercard A2A integration uses OAuth 1.0a RSA-SHA256 — standard financial API compliance
- No SIM card, MVNO, or licensed spectrum involvement
- Local data residency: Firebase project can be configured to any GCP region; local JSON backend keeps data entirely on-premises

---

## 10. Risk Register

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|------------|
| R01 | WhatsApp ToS enforcement breaks Baileys | Medium | High | Upgrade to official WhatsApp Business API; Telegram remains fully functional |
| R02 | MikroTik RouterOS API breaking change | Low | High | Pin `routeros-client` version; test on RouterOS 7.x only |
| R03 | LLM provider outage | Medium | Medium | Multi-provider fallback: Gemini → Claude → OpenAI → Ollama (local); tier-1 and tier-2 always available |
| R04 | Firebase quota exhaustion | Low | Medium | Local backend as drop-in fallback; Firebase quotas generous for single-operator scale |
| R05 | Telegram polling conflict (duplicate instances) | Medium | Low | `drop_pending_updates: true`, conflict error logged and handled gracefully |
| R06 | Router credentials change locks out AgentOS | Low | High | `MIKROTIK_PASS` update + restart; `/setup` Telegram wizard for in-band reconfiguration |
| R07 | Starlink connectivity interruption | High | Medium | AgentOS continues running; reconnect logic with exponential backoff (max 10 attempts) |
| R08 | Node.js process crash | Medium | High | systemd `Restart=always`, `RestartSec=5`; `uncaughtException` handler logs before exit |
| R09 | Audit log gap (pre-v2026.7.0 Firebase deployments) | Low | Low | Rolling buffer fixed in v2026.7.0; historical Firebase data unaffected |
| R10 | Emotion state cache unbounded growth | Low | Medium | Fixed in v2026.7.0 (capped at 10,000 entries with `clear()`) |

---

## 11. Roadmap

### v2026.8.0 — Payments & Provisioning

- Mpesa STK Push integration (East Africa primary payment rail)
- Automated provisioning via RouterOS API scheduler (remove manual `/setup` steps)
- Voucher QR code scanner page (`/scan.html`) for captive portal integration
- Data quota enforcement (`limit-bytes-total` per MikroTik profile)

### v2026.9.0 — Analytics & Reporting

- 30-day revenue dashboard (HTML artifact, cyberpunk theme)
- Automated daily/weekly operator email digest
- ARPU, churn rate, and device count trend tracking
- Export voucher ledger to CSV

### v2027.1.0 — Multi-tenancy

- Per-operator config namespacing
- Shared Firebase project with tenant isolation
- Operator signup and onboarding API
- Usage-based billing for SaaS deployment

### v2027.2.0 — WhatsApp Business API Migration

- Replace Baileys with official WhatsApp Business Cloud API
- Interactive message templates for plan selection
- Payment link generation via WhatsApp Pay (where available)

### Ongoing

- Swahili NLU accuracy improvements
- RouterOS v8 compatibility testing
- OpenWRT adapter (stub → implementation)
- Plugin SDK documentation and marketplace

---

## Appendix A — Bug Fix Log (v2026.7.0)

| ID | Location | Description |
|----|----------|-------------|
| FIX-011 | `AgentOSBot.init()` | Removed duplicate `TelegramBot` instance; added try/catch around `messaging.initialize()` |
| FIX-012 | Bootstrap §26 | `Object.keys([...map.keys()])` → `Map.keys()` iterator for SSE/broadcast hooks |
| FIX-013 | `AgentOSOrchestrator._runCron` | Added `lastReboot`/`lastHeartbeat` date guards; migrated to `_cronFire()` helper |
| FIX-014 | `AgentOSBot._handleCallback` | `this._tools().execute()` → `toolRegistry.execute()` |
| GAP-001 | `AskEngine._declarations` | Added `manage_project` declaration with 9 actions |
| GAP-002 | `AskEngine._dispatch` | Added `manage_project` routing to `ProjectManager` |
| GAP-003 | `ToolRegistry._registerBuiltins` | Added 9 `project.*` tool definitions |
| BUG-001 | `AgentOSOrchestrator._cronFire` | Tick missing date — cron fired once ever, never repeated |
| BUG-002 | `AgentOSBot.init()` | No try/catch — Telegram error crashed daemon boot |
| BUG-003 | `AgentOSGateway.closeAll()` | `forEach(c =>)` passed value not key to `_stopHeartbeat(id)` |
| BUG-004 | `Database.logAuditTrail()` | `_audit` buffer not populated in Firebase mode → selfAudit permanently blind |
| BUG-005 | `AgentOSBot._getEmotion()` | `_emotions` Map grew unbounded — capped at 10,000 |
| BUG-006 | `EmotionEngine._clamp()` | Generic loop applied wrong floor to `urgency`/`energy` |

---

*AgentOS — Built for Africa's last-mile operators.*  
*Br3eze Africa · br3ezeafrica · github.com/br3ezeafrica*
