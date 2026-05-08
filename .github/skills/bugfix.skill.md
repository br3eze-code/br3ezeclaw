# AgentOS Bug Hunt Skill
# Used by run-skill-chain.js PHASE 3
# Executed with extended_thinking budget=6000

---

## BUG_HUNT

You are a senior Node.js engineer debugging a production daemon. Find every bug that causes crashes, data loss, or incorrect behaviour.

AgentOS runtime context:
- Long-running daemon (never restarts in production unless Cloud Run reschedules)
- Handles concurrent Telegram + WhatsApp + WebSocket messages simultaneously
- routeros-client v1.1.1 uses slash path notation: `/ip/hotspot/user` ✓, `/ip hotspot user` ✗
- Jest testMatch: `**/tests/**/*.test.js` — files in root (`test-firebase.js` etc.) never run
- Jest modulePaths: `['/tmp/jest-deps/node_modules']` — tests fail if this path is missing
- PORT=3000 (HTTP/Cloud Run), GATEWAY_PORT=19876 (WebSocket)
- `migration.js` in root — must be idempotent

Bug categories:

**B1 — Async/Promise**
- async functions called without `await`
- `.then()` chains with missing `.catch()`
- Firestore `.get()` result used without `.exists` check → `.data()` returns undefined
- `Promise.all()` where one rejection kills the whole batch silently

**B2 — RouterOS API Misuse**
- Wrong path format (space vs slash notation for routeros-client)
- Missing connection error handling — RouterOS disconnect kills daemon
- `router.connect()` called multiple times → duplicate connections
- Assuming command returns array when it returns object (`.active-address` etc.)
- `limit-bytes-total` set as string instead of number

**B3 — Memory Leaks**
- `bot.on('message', handler)` registered multiple times (bot restart without cleanup)
- `setInterval` / `setTimeout` stored without clearance path
- EventEmitter listeners added in request handlers (grows unbounded)
- WebSocket clients not removed from Set on disconnect

**B4 — Daemon Stability**
- `process.exit(1)` in any error handler that should be recoverable
- Unhandled `process.on('uncaughtException')` / `process.on('unhandledRejection')` — does it exist?
- Firebase Admin SDK re-initialization (`initializeApp` called twice → throws)
- `better-sqlite3` synchronous operations blocking the event loop under load

**B5 — Data Integrity**
- Voucher creation without atomic Firestore transaction → duplicate vouchers possible
- `migration.js` — non-idempotent migration that corrupts on re-run
- MAC address normalization — uppercase vs lowercase mismatch in `users/HST-{MAC}` key
- `limit-bytes-total` not reset when voucher is revoked

**B6 — Test Coverage Gaps**
- Root test files (`test-firebase.js`, `test-mikrotik.js`, `test.br3eze.js`) outside Jest testMatch
- Tests using live Firebase/RouterOS connections (should be mocked)
- No test for concurrent voucher creation race condition

**B7 — ESM/CJS Conflicts**
- `agentos.js` (CJS) and `agentos.mjs` (ESM) — duplicate entry points with divergent logic?
- `"type": "commonjs"` in package.json — any `.mjs` file using `require()` will crash
- Dynamic `import()` inside CJS context

Output JSON:
```json
{
  "bugs": [
    {
      "id": "BUG-001",
      "category": "B1|B2|B3|B4|B5|B6|B7",
      "severity": "CRASH|HIGH|MEDIUM|LOW",
      "title": "string",
      "file": "path/to/file.js",
      "line_hint": "function or area",
      "description": "what breaks and under what conditions",
      "reproduction": "how to trigger this bug",
      "fix": "exact code fix or concrete approach"
    }
  ],
  "summary": {
    "CRASH": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0,
    "category_counts": { "B1": 0, "B2": 0, "B3": 0, "B4": 0, "B5": 0, "B6": 0, "B7": 0 }
  }
}
```
Output ONLY the JSON.
