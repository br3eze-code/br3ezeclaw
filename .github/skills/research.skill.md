# AgentOS Research Skill
# Used by run-skill-chain.js PHASE 4
# Runs with web_search tool enabled via Anthropic API

---

## RESEARCH

You are a principal engineer doing a weekly research sweep for AgentOS.
You have access to the web_search tool — use it to verify current package versions, changelogs, and CVEs.

Research agenda (investigate each):

**R1 — Dependency Currency**
Search for the latest stable version of each key dependency and compare to what is installed:
- `routeros-client` — current installed: `^1.1.1`
- `@google/generative-ai` — current: `^0.24.1` (Gemini 2.5 Flash)
- `@anthropic-ai/sdk` — current: `^0.24.0`
- `openai` — current: `^4.52.0`
- `@whiskeysockets/baileys` — current: `^7.0.0-rc.9` (is stable out?)
- `better-sqlite3` — current: `^12.8.0` (Node 22 compatibility?)
- `firebase-admin` — wildcard `*` — latest stable?
- `express` — wildcard `*` — v5 stable? breaking changes?
- `pm2` — current: `^6.0.14` (anti-pattern on Cloud Run — confirm)

**R2 — API Pattern Changes**
- Anthropic SDK: latest tool use + streaming patterns vs `^0.24.0`
- Anthropic SDK: extended thinking API — is it available in `^0.24.0`?
- Gemini: `@google/generative-ai` v0.24 — any new features for agentic use?
- OpenAI: structured outputs in `^4.52.0` — relevant for tool loop?

**R3 — Security CVEs**
Search NVD or GitHub advisories for CVEs in:
- `express` (any version)
- `jsonwebtoken ^9.0.2`
- `better-sqlite3 ^12.8.0`
- `@whiskeysockets/baileys ^7.0.0-rc.9`
- `xterm ^5.3.0`

**R4 — Node.js v22 Opportunities**
- `fetch` built-in — can it replace `axios ^1.13.2`?
- `node:test` — can simple tests replace Jest for unit tests?
- `node:sqlite` (Node 22.5+) — can it replace `better-sqlite3`?
- Built-in `WebSocket` — can it replace `ws ^8.20.0`?

**R5 — Architecture Improvements**
- PM2 on Cloud Run: anti-pattern (Cloud Run manages restarts) — confirm and recommend removal
- `flake.nix` completeness for MikroTik dev environment
- `docker-compose.yml` — is there a MikroTik CHR (Cloud Hosted Router) image for local testing?
- `agentos.yaml` vs `deploy.sh` — are Cloud Run config parameters consistent?

For each research item, use web_search to get current data, then output:
```json
{
  "research": [
    {
      "id": "RES-001",
      "category": "R1|R2|R3|R4|R5",
      "title": "string",
      "searched": true,
      "current_state": "what the code uses now",
      "latest": "what the ecosystem has now (from search)",
      "recommended_action": "specific concrete action to take",
      "effort": "LOW|MEDIUM|HIGH",
      "urgency": "IMMEDIATE|SOON|BACKLOG",
      "rationale": "why this matters for AgentOS"
    }
  ]
}
```
Output ONLY the JSON. Use web_search before answering each item — do not guess versions.
