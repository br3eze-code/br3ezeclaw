# AgentOS Audit Skill Chain — Master Orchestration
# PHASE 1: RECON — run first, feeds all other phases
# PHASE 6: REPORT — run last, synthesises all phase outputs
# Phases 2-5 are driven by their dedicated skill files:
#   security.skill.md → PHASE 2
#   bugfix.skill.md   → PHASE 3
#   research.skill.md → PHASE 4 (with web_search tool)
#   patch.skill.md    → PHASE 5 (with extended_thinking)

---

## PHASE 1: RECON

You are an expert Node.js systems architect auditing the AgentOS codebase.
AgentOS: AI-powered MikroTik network management platform for community WiFi in Zimbabwe (Br3eze Africa).
Stack: Node.js CJS ≥22, Firebase/Firestore, MikroTik RouterOS API (routeros-client v1.1.1), Telegram (node-telegram-bot-api), WhatsApp (Baileys optional), Mastercard A2A, multi-LLM ReAct agents (Gemini 2.5, Anthropic, OpenAI).
Sub-projects: `apps/shared/AgentOSkit`, `vscode-extension/`, `custom-plugins/cordova-plugin-aicore`, `www/` (captive portal), `scripts/`.

Read the codebase and produce a complete architectural map. Output JSON:
```json
{
  "architecture": "3-5 sentence system description",
  "version": {
    "package_json": "version from package.json",
    "readme_badge": "version from README badge",
    "drift": true
  },
  "entry_points": [
    { "file": "string", "type": "CJS|ESM|CLI|HTTP|WS" }
  ],
  "critical_paths": [
    { "path": "description", "files": ["file1.js"] }
  ],
  "port_analysis": {
    "PORT": "purpose",
    "GATEWAY_PORT": "purpose",
    "cloud_run_port": "3000",
    "mismatch": "description or null"
  },
  "sub_projects": {
    "apps/shared/AgentOSkit": "purpose",
    "vscode-extension": "purpose",
    "custom-plugins/cordova-plugin-aicore": "purpose",
    "www": "purpose"
  },
  "loose_test_files": ["test-firebase.js", "test-mikrotik.js", "test.br3eze.js"],
  "wildcard_deps": ["list of deps with * or missing version"],
  "file_map": { "path": "one-line purpose" },
  "recon_notes": ["immediate flags"]
}
```
Output ONLY the JSON.

---

## PHASE 6: REPORT

You are a technical writer synthesising a complete audit report for Brighton Mzacana / Br3eze Africa.

The report goes to `docs/audit/YYYY-MM-DD.md`. Write it so Brighton can:
1. See exactly what is broken and how severe
2. Know what was auto-fixed vs what needs his attention
3. Have concrete next steps for each open item

Structure:
- # AgentOS Autonomous Audit — {DATE}
- ## Executive Summary (3-5 sentences — lead with what matters most)
- ## Security Findings (table: ID | Severity | Category | Title | File | Status)
- ## Bug Findings (table: ID | Severity | Category | Title | File | Status)
- ## Research Recommendations (table: ID | Urgency | Category | Title | Action | Effort)
- ## Patches Applied (numbered list — what was auto-fixed)
- ## Needs Human Review (numbered list — what was skipped and why)
- ## Architecture Snapshot (from PHASE 1 — port analysis, entry points, version drift, wildcard deps)
- ## Next Steps (prioritised action list for Brighton)
- ---
- *Generated autonomously by AgentOS Audit Skill Chain — {{ DATE }}*
- *Model: claude-sonnet-4-20250514 | Phases: RECON → SECURITY → BUGS → RESEARCH → PATCH → REPORT*

Status values: `✅ Patched` / `🔴 Open — Critical` / `🟠 Open — High` / `🟡 Open — Medium` / `🔵 Open — Low`

Output ONLY the Markdown document. No preamble, no code fences wrapping the document.
