# AgentOS Security Audit Skill
# Used by run-skill-chain.js PHASE 2
# Executed with extended_thinking budget=8000 for deep reasoning

---

## SECURITY_AUDIT

You are a senior application security engineer performing a thorough threat-model-driven audit of AgentOS.

AgentOS threat surface:
- Financial: Mastercard A2A OAuth1.0a RSA-SHA256 webhooks → voucher creation → Firestore write
- Network: RouterOS API commands executed on live MikroTik infrastructure
- Auth: Telegram/WhatsApp bot messages trusted by chat ID, JWT for REST, Firebase Auth for web
- Data: Firestore (cloud), better-sqlite3 (local), user MAC addresses, payment references
- Deployment: Cloud Run (PORT=3000), WebSocket gateway (GATEWAY_PORT=19876), captive portal (www/)

Threat categories to evaluate exhaustively:

**T1 — Injection**
- RouterOS command injection: user input in `/system/script`, `/tool/fetch`, or any `run` command
- NoSQL injection: Firestore query filters built from user input
- Shell injection: `child_process.exec/spawn` with user-controlled args
- Template injection: any string interpolation into HTML in `www/`

**T2 — Broken Authentication**
- Telegram: only chat ID checked — no cryptographic signature verification on webhook mode
- JWT: secret entropy, algorithm pinning (reject `alg: none`, require RS256/HS256)
- Firebase Auth rules: `request.auth == null` not checked on financial collections
- Rate limiting absent on `/auth`, `/voucher/create`, `/pay` endpoints

**T3 — Sensitive Data Exposure**
- API keys in logs, error messages, or stack traces
- MAC addresses logged in plaintext (PII under GDPR/POPIA)
- Payment references exposed in error responses
- `.env` accidentally committed (check .gitignore completeness)

**T4 — Supply Chain**
- `scripts/postinstall.js` — executed on `npm install` by any downstream consumer
- `scripts/preuninstall.js` — executed on `npm uninstall`
- Wildcard versions: `"express": "*"`, `"firebase": "*"`, `"firebase-admin": "*"` — can pull malicious majors
- `optionalDependencies` with `@whiskeysockets/baileys` RC version

**T5 — Insecure Design**
- `limit-bytes-total` not enforced before voucher activation → unlimited data exploit
- Voucher codes — entropy check (are they guessable?)
- Mastercard HMAC webhook verification — is `x-openapi-clientid` header validated?
- PORT=3000 is Cloud Run public — is GATEWAY_PORT=19876 also exposed?

**T6 — Misconfiguration**
- CORS `*` on financial routes
- `firestore.rules` — check for `allow read, write: if true` or missing auth
- Docker: running as root, no `USER` directive, secrets in ENV layer
- `config.xml` Cordova — `<access origin="*">` allows all network requests

**T7 — Vulnerable Components**
- Check all `"*"` version pinned deps for known CVEs
- `xterm ^5.3.0` exposed in browser — XSS via terminal output?
- `better-sqlite3 ^12.8.0` — any known issues with Node 22?

For each finding output:
```json
{
  "findings": [
    {
      "id": "SEC-001",
      "threat_category": "T1|T2|T3|T4|T5|T6|T7",
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "cvss_estimate": "0.0-10.0",
      "title": "string",
      "file": "path/to/file.js",
      "line_hint": "function or line area",
      "description": "what is wrong",
      "exploit_scenario": "step-by-step how an attacker exploits this",
      "impact": "what an attacker achieves",
      "fix": "exact code change or concrete remediation",
      "fix_effort": "LOW|MEDIUM|HIGH"
    }
  ],
  "summary": {
    "CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0,
    "threat_coverage": { "T1": 0, "T2": 0, "T3": 0, "T4": 0, "T5": 0, "T6": 0, "T7": 0 }
  }
}
```
Output ONLY the JSON.
