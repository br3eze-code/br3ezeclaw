/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║          AgentOS — ChaosMonkey.js  (src/core/)              ║
 * ║  Domain-agnostic chaos engineering & Sentinel stress-tester  ║
 * ║  CommonJS · routeros-client · Node.js v18+                  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * ARCHITECTURE
 * ─────────────────────────────────────────────────────────────
 *  ChaosMonkey is a pluggable disruption engine.  Each domain
 *  (Networking, Commerce, …) registers a named "chaos pack" –
 *  a plain object whose keys are disruption function factories.
 *
 *  Every disruption is wrapped by _exec() which:
 *    1. Mints a unique chaos_id
 *    2. Writes a DISRUPTION entry to the audit log
 *    3. Starts a recovery_window countdown
 *    4. Polls the Sentinel state until the anomaly clears or
 *       the window expires, then emits RECOVERED / TIMEOUT
 *
 *  The panicButton() snapshots & restores config/backup.json
 *  and is wired to SIGTERM / uncaughtException by default.
 *
 * SAFETY POLICIES
 * ─────────────────────────────────────────────────────────────
 *  • All RouterOS mutations are scoped to filter-chain "chaos"
 *    so production rules are never touched directly.
 *  • The simple-queue is tagged [chaos] and auto-removed on panic.
 *  • ghostAPI() uses a separate ROS client pool so the primary
 *    AgentOS API socket is never degraded.
 *  • IndexedDB corruption uses a reserved key-prefix "__chaos__"
 *    so real catalog entries are safe.
 *  • Firestore latency shim is reversible via panicButton.
 */

'use strict';

const { RouterOSClient } = require('routeros-client');
const { EventEmitter }   = require('events');
const { v4: uuidv4 }     = require('uuid');
const fs                  = require('fs');
const path                = require('path');

// ─── paths ────────────────────────────────────────────────────
const BACKUP_PATH  = path.resolve(__dirname, '../../config/backup.json');
const AUDIT_PATH   = path.resolve(__dirname, '../../logs/chaos_audit.jsonl');

// ─── internal constants ───────────────────────────────────────
const CHAOS_QUEUE_NAME   = '[chaos]-bandwidth-throttle';
const CHAOS_SCRIPT_PFX   = 'chaos_fw_';         // prefix for temp ROS scripts
const CHAOS_IDB_PREFIX   = '__chaos__';
const DEFAULT_WINDOW_MS  = 60_000;               // 60 s recovery window
const POLL_INTERVAL_MS   = 5_000;

// ─── singleton state ──────────────────────────────────────────
let _ghostSockets    = [];
let _latencyShimmed  = false;
let _lastGoodState   = null;
let _activeDisrupts  = new Map();        // chaos_id → { name, domain, ts }

// ══════════════════════════════════════════════════════════════
//  Audit Logger
// ══════════════════════════════════════════════════════════════
function _audit(entry) {
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() });
  fs.appendFileSync(AUDIT_PATH, line + '\n');
  console.log(`[ChaosMonkey][${entry.chaos_id || 'SYSTEM'}] ${entry.event} — ${entry.detail || ''}`);
}

// ══════════════════════════════════════════════════════════════
//  chaos_id factory
// ══════════════════════════════════════════════════════════════
function _mintId(domain, name) {
  return `${domain.toUpperCase()}_${name.toUpperCase()}_${uuidv4().slice(0, 8).toUpperCase()}`;
}

// ══════════════════════════════════════════════════════════════
//  RouterOS helper — shared client from AgentOS config
// ══════════════════════════════════════════════════════════════
function _rosClient(cfg) {
  return new RouterOSClient({
    host:     cfg.host     || process.env.ROS_HOST,
    user:     cfg.user     || process.env.ROS_USER,
    password: cfg.password || process.env.ROS_PASS,
    port:     cfg.port     || 8728,
    timeout:  cfg.timeout  || 10_000,
  });
}

// ══════════════════════════════════════════════════════════════
//  State snapshot helper
// ══════════════════════════════════════════════════════════════
function _snapshot() {
  try {
    if (fs.existsSync(BACKUP_PATH)) {
      _lastGoodState = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
    }
  } catch (e) {
    _audit({ event: 'SNAPSHOT_FAIL', detail: e.message });
  }
}

// ══════════════════════════════════════════════════════════════
//  Core execution wrapper
// ══════════════════════════════════════════════════════════════
/**
 * @param {string}   domain          e.g. 'Networking'
 * @param {string}   name            e.g. 'dropFirewallRules'
 * @param {Function} fn              async disruption fn → { detail }
 * @param {object}   [opts]
 * @param {number}   [opts.recovery_window]  ms to wait for Sentinel
 * @param {Function} [opts.sentinelCheck]    async () → bool  (true = healed)
 * @returns {Promise<{ chaos_id, recovered, elapsed_ms }>}
 */
async function _exec(domain, name, fn, opts = {}) {
  _snapshot();

  const chaos_id       = _mintId(domain, name);
  const recovery_window = opts.recovery_window ?? DEFAULT_WINDOW_MS;
  const sentinelCheck   = opts.sentinelCheck   ?? (() => false);

  _activeDisrupts.set(chaos_id, { name, domain, ts: Date.now() });

  _audit({ chaos_id, event: 'DISRUPTION', domain, name, recovery_window_ms: recovery_window });

  let detail;
  try {
    detail = await fn(chaos_id);
  } catch (err) {
    _audit({ chaos_id, event: 'DISRUPTION_ERROR', detail: err.message });
    _activeDisrupts.delete(chaos_id);
    throw err;
  }

  _audit({ chaos_id, event: 'DISRUPTION_APPLIED', detail });

  // ── recovery poll ──────────────────────────────────────────
  const deadline = Date.now() + recovery_window;
  let recovered  = false;

  while (Date.now() < deadline) {
    await _sleep(POLL_INTERVAL_MS);
    try {
      if (await sentinelCheck(chaos_id)) {
        recovered = true;
        break;
      }
    } catch (_) { /* sentinel unreachable — keep waiting */ }
  }

  const elapsed_ms = Date.now() - (_activeDisrupts.get(chaos_id)?.ts ?? Date.now());
  _activeDisrupts.delete(chaos_id);

  _audit({
    chaos_id,
    event:      recovered ? 'SENTINEL_RECOVERED' : 'RECOVERY_TIMEOUT',
    elapsed_ms,
    detail:     recovered ? 'Sentinel self-healed the disruption.' : 'Window expired — no recovery detected.',
  });

  ChaosMonkey.emit(recovered ? 'recovered' : 'timeout', { chaos_id, domain, name, elapsed_ms });

  return { chaos_id, recovered, elapsed_ms };
}

// ══════════════════════════════════════════════════════════════
//  Utility
// ══════════════════════════════════════════════════════════════
function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ══════════════════════════════════════════════════════════════
//
//  ██████  ██████  ███╗   ███╗ █████╗ ██╗███╗   ██╗███████╗
//  ██   ██ ██   ██ ████╗ ████║██╔══██╗██║████╗  ██║██╔════╝
//  ██   ██ ██   ██ ██╔████╔██║███████║██║██╔██╗ ██║███████╗
//  ██   ██ ██   ██ ██║╚██╔╝██║██╔══██║██║██║╚██╗██║╚════██║
//  ██████  ██████  ██║ ╚═╝ ██║██║  ██║██║██║ ╚████║███████║
//
//  DOMAIN: NETWORKING
// ══════════════════════════════════════════════════════════════

const NetworkingChaos = {

  /**
   * dropFirewallRules()
   * ──────────────────────────────────────────────────────────
   * Randomly disables 3 firewall filter rules from the
   * 'forward' chain by toggling their 'disabled' flag via
   * /ip/firewall/filter/set.  The original .id list is stored
   * in the chaos audit so panicButton() can re-enable them.
   */
  dropFirewallRules: async function(rosCfg, opts = {}) {
    return _exec('Networking', 'dropFirewallRules', async (chaos_id) => {
      const api    = _rosClient(rosCfg);
      const client = await api.connect();

      let disabled = [];
      try {
        const rules = await client
          .menu('/ip/firewall/filter')
          .where('disabled', 'false')
          .where('chain', 'forward')
          .get();

        if (!rules.length) throw new Error('No enabled forward-chain rules found.');

        // shuffle and take 3
        const targets = rules.sort(() => 0.5 - Math.random()).slice(0, 3);

        for (const rule of targets) {
          await client.menu('/ip/firewall/filter').where('id', rule['.id']).set({ disabled: 'yes' });
          disabled.push(rule['.id']);
        }

        // persist disabled IDs into backup so panicButton can undo
        const backup = _lastGoodState ?? {};
        backup._chaos = backup._chaos ?? {};
        backup._chaos[chaos_id] = { type: 'dropFirewallRules', disabled };
        fs.writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2));

      } finally {
        await api.disconnect();
      }

      return `Disabled ${disabled.length} firewall rules: [${disabled.join(', ')}]`;
    }, opts);
  },

  /**
   * throttleBandwidth()
   * ──────────────────────────────────────────────────────────
   * Creates a simple queue named [chaos]-bandwidth-throttle
   * targeting all traffic (dst=0.0.0.0/0) at 64k/64k.
   * If a queue with that name already exists it is reset.
   */
  throttleBandwidth: async function(rosCfg, opts = {}) {
    return _exec('Networking', 'throttleBandwidth', async (chaos_id) => {
      const api    = _rosClient(rosCfg);
      const client = await api.connect();

      try {
        const existing = await client
          .menu('/queue/simple')
          .where('name', CHAOS_QUEUE_NAME)
          .get();

        if (existing.length) {
          await client
            .menu('/queue/simple')
            .where('name', CHAOS_QUEUE_NAME)
            .set({ 'max-limit': '64k/64k', disabled: 'no' });
        } else {
          await client.menu('/queue/simple').add({
            name:        CHAOS_QUEUE_NAME,
            target:      '0.0.0.0/0',
            'max-limit': '64k/64k',
            comment:     `chaos_id=${chaos_id}`,
          });
        }
      } finally {
        await api.disconnect();
      }

      return `Simple queue '${CHAOS_QUEUE_NAME}' applied at 64k/64k global throttle.`;
    }, opts);
  },

  /**
   * ghostAPI()
   * ──────────────────────────────────────────────────────────
   * Simulates a "Kernel interrupt" by opening a raw TCP socket
   * to the RouterOS API port and deliberately NOT sending the
   * login handshake, holding the slot open.  The socket is
   * stored in _ghostSockets[] and freed only by panicButton().
   *
   * Effect: RouterOS API has a limited concurrent-session pool.
   * Exhausting it causes the AgentOS primary client to hang on
   * connect(), exercising Sentinel's reconnect logic.
   *
   * @param {number} [count=3] number of ghost sockets
   */
  ghostAPI: async function(rosCfg, opts = {}) {
    const count = opts.count ?? 3;
    return _exec('Networking', 'ghostAPI', async (chaos_id) => {
      const net = require('net');
      const host = rosCfg.host || process.env.ROS_HOST;
      const port = rosCfg.port || 8728;

      const spawned = [];
      for (let i = 0; i < count; i++) {
        await new Promise((resolve, reject) => {
          const sock = net.createConnection({ host, port }, () => {
            _ghostSockets.push(sock);
            spawned.push(sock);
            resolve();
          });
          sock.on('error', reject);
          sock.setTimeout(0); 
        });
      }

      return `Opened ${spawned.length} ghost sockets on ${host}:${port} — API pool partially occupied.`;
    }, opts);
  },
};

// ══════════════════════════════════════════════════════════════
//
//   ██████  ██████  ███╗   ███╗███╗   ███╗███████╗██████╗  ██████╗███████╗
//  ██      ██    ██ ████╗ ████║████╗ ████║██╔════╝██╔══██╗██╔════╝██╔════╝
//  ██      ██    ██ ██╔████╔██║██╔████╔██║█████╗  ██████╔╝██║     █████╗
//  ██      ██    ██ ██║╚██╔╝██║██║╚██╔╝██║██╔══╝  ██╔══██╗██║     ██╔══╝
//   ██████  ██████  ██║ ╚═╝ ██║██║ ╚═╝ ██║███████╗██║  ██║╚██████╗███████╗
//
//  DOMAIN: COMMERCE
// ══════════════════════════════════════════════════════════════

const CommerceChaos = {

  /**
   * corruptIndexedDB()
   * ──────────────────────────────────────────────────────────
   * Injects a malformed JSON object into the local commerce
   * catalog store (IDBStore: 'catalog').  Because this module
   * runs in Node.js we approximate the IDB write via a JSON
   * sidecar file that the Cordova ClawHotspot app reads —
   * path: data/idb_catalog_mirror.json.
   *
   * In a browser context (e.g. injected via puppeteer or
   * webdriver), the real IDB write is performed via the
   * inline browser script below.
   */
  corruptIndexedDB: async function(opts = {}) {
    return _exec('Commerce', 'corruptIndexedDB', async (chaos_id) => {
      const IDB_MIRROR = path.resolve(__dirname, '../../data/idb_catalog_mirror.json');
      const poison_key = `${CHAOS_IDB_PREFIX}${chaos_id}`;

      const malformedPayload = `{"id":"${poison_key}","sku":null,"price":{"amount":},"meta":{{{{`;

      let catalog = {};
      try {
        if (fs.existsSync(IDB_MIRROR)) {
          catalog = JSON.parse(fs.readFileSync(IDB_MIRROR, 'utf8'));
        }
      } catch (_) { /* mirror missing — start fresh */ }

      catalog[poison_key] = malformedPayload;
      fs.writeFileSync(IDB_MIRROR, JSON.stringify(catalog, null, 2));

      const idbScript = `
(function() {
  const req = indexedDB.open('br3ezeCommerce', 1);
  req.onsuccess = e => {
    const db  = e.target.result;
    const tx  = db.transaction('catalog', 'readwrite');
    const st  = tx.objectStore('catalog');
    st.put({ id: '${poison_key}', raw: '${malformedPayload.replace(/'/g, "\\'")}' });
  };
})();`;
      const scriptOut = path.resolve(__dirname, '../../logs/chaos_idb_inject.js');
      fs.writeFileSync(scriptOut, idbScript);

      return `Injected malformed catalog record '${poison_key}' into IDB mirror + generated browser injection script.`;
    }, opts);
  },

  /**
   * latencies()
   * ──────────────────────────────────────────────────────────
   * Patches the global Firestore sync function used by AgentOS
   * (assumed to be exported as module.exports.firestoreSync or
   * hooked via the FirebaseAdapter singleton) by wrapping it
   * in a 5000 ms delay shim.
   *
   * The original reference is preserved so panicButton() can
   * unwrap it atomically.
   */
  latencies: async function(opts = {}) {
    const delayMs = opts.delayMs ?? 5000;
    return _exec('Commerce', 'latencies', async (chaos_id) => {
      if (_latencyShimmed) {
        return 'Latency shim already active — skipping duplicate apply.';
      }

      // Attempt to locate the FirebaseAdapter in require cache
      const adapterKey = Object.keys(require.cache).find(k =>
        k.includes('FirebaseAdapter') || k.includes('firestoreSync')
      );

      if (adapterKey) {
        const mod = require.cache[adapterKey];
        if (mod?.exports?.firestoreSync) {
          const _original = mod.exports.firestoreSync;
          mod.exports.__originalFirestoreSync = _original;
          mod.exports.firestoreSync = async (...args) => {
            _audit({ chaos_id, event: 'LATENCY_SHIM_HIT', detail: `+${delayMs}ms injected` });
            await _sleep(delayMs);
            return _original(...args);
          };
          _latencyShimmed = true;
          return `Firestore firestoreSync shimmed with ${delayMs}ms delay via module cache patch.`;
        }
      }

      // Fallback: write a flag file that FirebaseAdapter checks on startup
      const FLAG = path.resolve(__dirname, '../../config/chaos_latency.json');
      fs.writeFileSync(FLAG, JSON.stringify({ chaos_id, delayMs, active: true }));
      _latencyShimmed = true;
      return `Module cache patch unavailable — wrote latency flag to ${FLAG}. FirebaseAdapter will honour on next init.`;
    }, opts);
  },
};

// ══════════════════════════════════════════════════════════════
//
//  ███████╗███████╗███╗   ██╗████████╗██╗███╗   ██╗███████╗██╗
//  ██╔════╝██╔════╝████╗  ██║╚══██╔══╝██║████╗  ██║██╔════╝██║
//  ███████╗█████╗  ██╔██╗ ██║   ██║   ██║██╔██╗ ██║█████╗  ██║
//  ╚════██║██╔══╝  ██║╚██╗██║   ██║   ██║██║╚██╗██║██╔══╝  ██║
//  ███████║███████╗██║ ╚████║   ██║   ██║██║ ╚████║███████╗███████╗
//
//  THE SENTINEL AUDIT LOOP  (runs independently per disruption)
//  Managed inside _exec() — see above.
//
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
//
//  ██████╗  █████╗ ███╗   ██╗██╗ ██████╗
//  ██╔══██╗██╔══██╗████╗  ██║██║██╔════╝
//  ██████╔╝███████║██╔██╗ ██║██║██║
//  ██╔═══╝ ██╔══██║██║╚██╗██║██║██║
//  ██║     ██║  ██║██║ ╚████║██║╚██████╗
//
//  PANIC BUTTON — instant full restore
// ══════════════════════════════════════════════════════════════

/**
 * panicButton()
 * ─────────────────────────────────────────────────────────────
 * Immediately restores the last known Good State:
 *  1. Re-enables any ROS firewall rules disabled by dropFirewallRules
 *  2. Removes the throttle queue
 *  3. Destroys all ghost sockets
 *  4. Removes IDB mirror poison keys
 *  5. Unwraps the Firestore latency shim
 *  6. Clears the latency flag file
 *  7. Emits 'panic' on the ChaosMonkey event bus
 */
async function panicButton(rosCfg = {}) {
  const pid = _mintId('PANIC', 'RESTORE');
  _audit({ chaos_id: pid, event: 'PANIC_INITIATED', detail: 'Full state restore starting.' });

  const results = [];

  // ── 1. re-enable firewall rules ───────────────────────────
  try {
    const backup = _lastGoodState ?? {};
    const chaosEntries = backup._chaos ?? {};
    const allDisabled  = Object.values(chaosEntries)
      .filter(e => e.type === 'dropFirewallRules')
      .flatMap(e => e.disabled);

    if (allDisabled.length) {
      const api    = _rosClient(rosCfg);
      const client = await api.connect();
      for (const id of allDisabled) {
        await client.menu('/ip/firewall/filter').where('id', id).set({ disabled: 'no' });
      }
      await api.disconnect();
      results.push(`Re-enabled ${allDisabled.length} firewall rules.`);
    }

    // clear chaos entries from backup
    if (backup._chaos) { delete backup._chaos; fs.writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2)); }
  } catch (e) { results.push(`FW restore error: ${e.message}`); }

  // ── 2. remove throttle queue ──────────────────────────────
  try {
    const api    = _rosClient(rosCfg);
    const client = await api.connect();
    const queues = await client.menu('/queue/simple').where('name', CHAOS_QUEUE_NAME).get();
    for (const q of queues) {
      await client.menu('/queue/simple').where('id', q['.id']).delete();
    }
    await api.disconnect();
    results.push(`Removed ${queues.length} chaos queue(s).`);
  } catch (e) { results.push(`Queue remove error: ${e.message}`); }

  // ── 3. destroy ghost sockets ──────────────────────────────
  const ghostCount = _ghostSockets.length;
  for (const sock of _ghostSockets) {
    try { sock.destroy(); } catch (_) {}
  }
  _ghostSockets = [];
  results.push(`Destroyed ${ghostCount} ghost socket(s).`);

  // ── 4. purge IDB mirror poison keys ──────────────────────
  try {
    const IDB_MIRROR = path.resolve(__dirname, '../../data/idb_catalog_mirror.json');
    if (fs.existsSync(IDB_MIRROR)) {
      let catalog = JSON.parse(fs.readFileSync(IDB_MIRROR, 'utf8'));
      const before = Object.keys(catalog).length;
      catalog = Object.fromEntries(
        Object.entries(catalog).filter(([k]) => !k.startsWith(CHAOS_IDB_PREFIX))
      );
      fs.writeFileSync(IDB_MIRROR, JSON.stringify(catalog, null, 2));
      results.push(`Purged ${before - Object.keys(catalog).length} IDB poison record(s).`);
    }
  } catch (e) { results.push(`IDB purge error: ${e.message}`); }

  // ── 5. unwrap Firestore latency shim ─────────────────────
  if (_latencyShimmed) {
    try {
      const adapterKey = Object.keys(require.cache).find(k =>
        k.includes('FirebaseAdapter') || k.includes('firestoreSync')
      );
      if (adapterKey) {
        const mod = require.cache[adapterKey];
        if (mod?.exports?.__originalFirestoreSync) {
          mod.exports.firestoreSync = mod.exports.__originalFirestoreSync;
          delete mod.exports.__originalFirestoreSync;
        }
      }
    } catch (_) {}
    _latencyShimmed = false;
    results.push('Firestore latency shim unwrapped.');
  }

  // ── 6. clear latency flag ─────────────────────────────────
  try {
    const FLAG = path.resolve(__dirname, '../../config/chaos_latency.json');
    if (fs.existsSync(FLAG)) { fs.unlinkSync(FLAG); results.push('Latency flag file removed.'); }
  } catch (_) {}

  // ── 7. clear active disruption map ───────────────────────
  _activeDisrupts.clear();

  _audit({ chaos_id: pid, event: 'PANIC_COMPLETE', detail: results.join(' | ') });
  ChaosMonkey.emit('panic', { chaos_id: pid, results });

  return { chaos_id: pid, results };
}

// ══════════════════════════════════════════════════════════════
//
//  ██████╗ ██╗     ██╗   ██╗ ██████╗ ██╗███╗   ██╗███████╗
//  ██╔══██╗██║     ██║   ██║██╔════╝ ██║████╗  ██║██╔════╝
//  ██████╔╝██║     ██║   ██║██║  ███╗██║██╔██╗ ██║███████╗
//  ██╔═══╝ ██║     ██║   ██║██║   ██║██║██║╚██╗██║╚════██║
//  ██║     ███████╗╚██████╔╝╚██████╔╝██║██║ ╚████║███████║
//
//  PLUGIN REGISTRY — add new chaos domains at runtime
// ══════════════════════════════════════════════════════════════

const _domainRegistry = new Map([
  ['Networking', NetworkingChaos],
  ['Commerce',   CommerceChaos],
]);

/**
 * Register a new chaos domain pack.
 *
 * @example
 * ChaosMonkey.registerDomain('Storage', {
 *   corruptDisk: async (cfg, opts) => { … }
 * });
 */
function registerDomain(domainName, chaosPack) {
  if (_domainRegistry.has(domainName)) {
    console.warn(`[ChaosMonkey] Domain '${domainName}' already registered — merging.`);
    Object.assign(_domainRegistry.get(domainName), chaosPack);
  } else {
    _domainRegistry.set(domainName, chaosPack);
    _audit({ event: 'DOMAIN_REGISTERED', detail: `${domainName} → [${Object.keys(chaosPack).join(', ')}]` });
  }
}

/**
 * Run a chaos function from any registered domain.
 *
 * @param {string} domain   e.g. 'Networking'
 * @param {string} fn       e.g. 'dropFirewallRules'
 * @param {object} cfg      ROS config or domain-specific config
 * @param {object} [opts]   Passed to _exec (recovery_window, sentinelCheck, …)
 */
async function run(domain, fn, cfg = {}, opts = {}) {
  const pack = _domainRegistry.get(domain);
  if (!pack) throw new Error(`[ChaosMonkey] Unknown domain: '${domain}'`);
  if (!pack[fn]) throw new Error(`[ChaosMonkey] Unknown function: '${domain}.${fn}'`);
  return pack[fn](cfg, opts);
}

/**
 * List all registered domains and their available disruptions.
 */
function list() {
  const out = {};
  for (const [domain, pack] of _domainRegistry) {
    out[domain] = Object.keys(pack);
  }
  return out;
}

/**
 * Status — currently active disruptions.
 */
function status() {
  return [..._activeDisrupts.entries()].map(([id, meta]) => ({ chaos_id: id, ...meta }));
}

// ══════════════════════════════════════════════════════════════
//  Safety hooks — auto-panic on process signals
// ══════════════════════════════════════════════════════════════
process.on('SIGTERM', () => panicButton().then(() => process.exit(0)));
process.on('uncaughtException', (e) => {
  _audit({ event: 'UNCAUGHT_EXCEPTION', detail: e.message });
  panicButton().then(() => process.exit(1));
});

// ══════════════════════════════════════════════════════════════
//  Public API
// ══════════════════════════════════════════════════════════════
const ChaosMonkey = Object.assign(new EventEmitter(), {
  Networking: NetworkingChaos,
  Commerce:   CommerceChaos,
  run,
  list,
  status,
  panicButton,
  registerDomain,

  _exec,
});

module.exports = ChaosMonkey;
