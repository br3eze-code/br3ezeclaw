/**
 * ChaosMonkey.v2.js - Production-Grade Fault Injection
 * A-Star Implementation with all critical bugs fixed
 * 
 * @version 2.0.0 - Production Ready
 */

'use strict';

const { RouterOSClient } = require('routeros-client');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const crypto = require('crypto');

// Domain registry
const CHAOS_DOMAINS = {
  NETWORKING: 'networking',
  COMMERCE: 'commerce',
  SYSTEM: 'system'
};

const SEVERITY = {
  LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical'
};

/**
 * AsyncMutex - Prevents race conditions in panic button
 */
class AsyncMutex {
  constructor() {
    this._locked = false;
    this._queue = [];
  }

  async acquire() {
    return new Promise(resolve => {
      if (!this._locked) {
        this._locked = true;
        resolve(() => this.release());
      } else {
        this._queue.push(resolve);
      }
    });
  }

  release() {
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      next(() => this.release());
    } else {
      this._locked = false;
    }
  }
}

/**
 * ConnectionPool - Properly managed MikroTik connections
 */
class ConnectionPool {
  constructor(maxSize = 5) {
    this.maxSize = maxSize;
    this.pool = new Map();
    this.inUse = new Set();
    this.ghostConnections = new Set(); // Track ghost connections separately
  }

  async getConnection(config) {
    // Return existing available connection
    for (const [id, conn] of this.pool) {
      if (!this.inUse.has(id) && !this.ghostConnections.has(id)) {
        this.inUse.add(id);
        return { conn, id, release: () => this.release(id) };
      }
    }

    // Create new if under limit
    if (this.pool.size < this.maxSize) {
      const conn = new RouterOSClient({
        host: config.host,
        user: config.user,
        password: config.password,
        port: config.port || 8728,
        timeout: config.timeout || 10000
      });

      await conn.connect();
      const id = crypto.randomUUID();
      this.pool.set(id, conn);
      this.inUse.add(id);
      
      return { conn, id, release: () => this.release(id) };
    }

    throw new Error('Connection pool exhausted');
  }

  createGhostConnection(config) {
    const conn = new RouterOSClient({
      host: config.host,
      user: config.user,
      password: config.password,
      port: config.port || 8728,
      timeout: 0 // No timeout for ghost
    });
    
    const id = `ghost-${crypto.randomUUID()}`;
    this.ghostConnections.add(id);
    this.pool.set(id, conn);
    
    return { conn, id, release: () => this.destroyGhost(id) };
  }

  release(id) {
    this.inUse.delete(id);
  }

  async destroyGhost(id) {
    const conn = this.pool.get(id);
    if (conn) {
      try {
        conn.close();
      } catch (e) {
        if (conn.socket) conn.socket.destroy();
      }
      this.pool.delete(id);
      this.ghostConnections.delete(id);
    }
  }

  async destroyAll() {
    for (const [id, conn] of this.pool) {
      try {
        conn.close();
      } catch (e) {
        if (conn.socket) conn.socket.destroy();
      }
    }
    this.pool.clear();
    this.inUse.clear();
    this.ghostConnections.clear();
  }
}

/**
 * FirestoreInterceptor - Actually functional latency injection
 */
class FirestoreInterceptor {
  constructor(firestoreInstance, delayMs) {
    this.db = firestoreInstance;
    this.delayMs = delayMs;
    this.originalMethods = new Map();
    this.installed = false;
  }

  install() {
    if (this.installed || !this.db) return;
    
    // Intercept common Firestore methods
    const methodsToIntercept = ['get', 'set', 'update', 'delete', 'add'];
    
    // Store originals and wrap
    const prototype = Object.getPrototypeOf(this.db);
    
    methodsToIntercept.forEach(method => {
      if (typeof this.db[method] === 'function') {
        this.originalMethods.set(method, this.db[method].bind(this.db));
        
        this.db[method] = async (...args) => {
          await this._delay();
          return this.originalMethods.get(method)(...args);
        };
      }
    });

    // Handle collection references
    const originalCollection = this.db.collection.bind(this.db);
    this.db.collection = (...args) => {
      const colRef = originalCollection(...args);
      return this._wrapCollectionReference(colRef);
    };

    this.installed = true;
  }

  _wrapCollectionReference(colRef) {
    const methods = ['get', 'add', 'doc'];
    const originals = {};
    
    methods.forEach(method => {
      if (typeof colRef[method] === 'function') {
        originals[method] = colRef[method].bind(colRef);
        colRef[method] = async (...args) => {
          await this._delay();
          return originals[method](...args);
        };
      }
    });

    // Wrap doc() to return wrapped document reference
    const originalDoc = originals['doc'] || colRef.doc?.bind(colRef);
    if (originalDoc) {
      colRef.doc = (...args) => {
        const docRef = originalDoc(...args);
        return this._wrapDocumentReference(docRef);
      };
    }

    return colRef;
  }

  _wrapDocumentReference(docRef) {
    const methods = ['get', 'set', 'update', 'delete'];
    const originals = {};
    
    methods.forEach(method => {
      if (typeof docRef[method] === 'function') {
        originals[method] = docRef[method].bind(docRef);
        docRef[method] = async (...args) => {
          await this._delay();
          return originals[method](...args);
        };
      }
    });

    return docRef;
  }

  async _delay() {
    return new Promise(resolve => setTimeout(resolve, this.delayMs));
  }

  uninstall() {
    if (!this.installed) return;
    
    // Restore original methods
    for (const [method, fn] of this.originalMethods) {
      this.db[method] = fn;
    }
    
    this.installed = false;
  }
}

/**
 * Production-Grade ChaosMonkey
 */
class ChaosMonkey extends EventEmitter {
  constructor(config = {}) {
    super();
    this.setMaxListeners(100); // Prevent memory leak warnings
    
    this.config = {
      recoveryWindow: config.recoveryWindow || 60000,
      backupPath: config.backupPath || path.join(process.cwd(), 'config', 'backup.json'),
      logPath: config.logPath || path.join(process.cwd(), 'logs', 'chaos.log'),
      maxConcurrentChaos: config.maxConcurrentChaos || 3,
      dryRun: config.dryRun || false,
      mikrotikHost: config.mikrotikHost,
      mikrotikUser: config.mikrotikUser,
      mikrotikPass: config.mikrotikPass,
      mikrotikPort: config.mikrotikPort || 8728,
      firestoreInstance: config.firestoreInstance || null,
      ...config
    };

    // Validate config
    this._validateConfig();

    // State management with mutex for thread safety
    this.activeChaos = new Map();
    this.chaosHistory = [];
    this.lastKnownGoodState = null;
    this.isArmed = false;
    this.panicMutex = new AsyncMutex();
    this.connectionPool = new ConnectionPool(5);
    
    // Firestore interceptor storage
    this.firestoreInterceptors = new Map();

    // Metrics with safe initialization
    this.metrics = {
      totalInjected: 0,
      totalRecovered: 0,
      totalFailed: 0,
      averageRecoveryTime: 0,
      lastRecoveredAt: null
    };

    this._initialized = false;
  }

  _validateConfig() {
    const required = ['mikrotikHost', 'mikrotikUser', 'mikrotikPass'];
    const missing = required.filter(key => !this.config[key]);
    
    if (missing.length > 0) {
      throw new Error(`ChaosMonkey config missing required fields: ${missing.join(', ')}`);
    }

    // Ensure log directory exists
    const logDir = path.dirname(this.config.logPath);
    fs.mkdir(logDir, { recursive: true }).catch(() => {});
  }

  async initialize() {
    if (this._initialized) return;
    
    await this._loadLastKnownGoodState();
    this._initialized = true;
    this.emit('initialized', { timestamp: new Date().toISOString() });
  }

  async _loadLastKnownGoodState() {
    try {
      const data = await fs.readFile(this.config.backupPath, 'utf8');
      this.lastKnownGoodState = JSON.parse(data);
      this._log('info', 'Last known good state loaded');
    } catch (error) {
      this._log('warn', 'Creating fresh backup state');
      this.lastKnownGoodState = this._createEmptyState();
      await this._saveBackupState();
    }
  }

  _createEmptyState() {
    return {
      firewall: { rules: [], ruleFingerprints: [] }, // Store fingerprints, not just IDs
      queues: [],
      commerce: { catalog: null, catalogHash: null },
      timestamp: new Date().toISOString()
    };
  }

  async _saveBackupState() {
    try {
      await fs.writeFile(
        this.config.backupPath, 
        JSON.stringify(this.lastKnownGoodState, null, 2)
      );
    } catch (error) {
      this._log('error', 'Failed to save backup state', { error: error.message });
    }
  }

  /**
   * Create rule fingerprint for reliable restoration
   */
  _createRuleFingerprint(rule) {
    // Hash of rule content (excluding ephemeral ID)
    const content = {
      chain: rule.chain,
      action: rule.action,
      protocol: rule.protocol,
      srcAddress: rule['src-address'],
      dstAddress: rule['dst-address'],
      srcPort: rule['src-port'],
      dstPort: rule['dst-port'],
      comment: rule.comment
    };
    return crypto.createHash('sha256')
      .update(JSON.stringify(content))
      .digest('hex');
  }

  _log(level, message, metadata = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      chaos_id: metadata.chaos_id || null,
      domain: metadata.domain || null,
      pid: process.pid,
      ...metadata
    };

    console.log(`[CHAOS:${level.toUpperCase()}] ${message}`, metadata);
    this.emit('chaosEvent', entry);
    
    // Async log write without blocking
    fs.appendFile(this.config.logPath, JSON.stringify(entry) + '\n')
      .catch(() => {});
  }

  _generateChaosId(domain, type) {
    return `chaos-${domain}-${type}-${uuidv4().split('-')[0]}`;
  }

  _recordChaos(chaosId, domain, type, originalState, recoveryFn) {
    const record = {
      chaos_id: chaosId,
      domain,
      type,
      injectedAt: Date.now(),
      recoveryWindow: this.config.recoveryWindow,
      expiresAt: Date.now() + this.config.recoveryWindow,
      originalState,
      recoveryFn,
      status: 'active',
      severity: this._calculateSeverity(domain, type),
      retryCount: 0
    };

    this.activeChaos.set(chaosId, record);
    this.metrics.totalInjected++;

    // Recovery watchdog
    this._startRecoveryWatchdog(chaosId);
    return record;
  }

  _calculateSeverity(domain, type) {
    const matrix = {
      [CHAOS_DOMAINS.NETWORKING]: {
        dropFirewallRules: SEVERITY.CRITICAL,
        throttleBandwidth: SEVERITY.HIGH,
        ghostAPI: SEVERITY.CRITICAL
      },
      [CHAOS_DOMAINS.COMMERCE]: {
        corruptIndexedDB: SEVERITY.MEDIUM,
        latencies: SEVERITY.LOW
      }
    };
    return matrix[domain]?.[type] || SEVERITY.MEDIUM;
  }

  _startRecoveryWatchdog(chaosId) {
    const record = this.activeChaos.get(chaosId);
    if (!record) return;

    const timeout = setTimeout(async () => {
      await this._evaluateRecovery(chaosId);
    }, this.config.recoveryWindow);

    record.timeoutRef = timeout;
  }

  async _evaluateRecovery(chaosId) {
    const record = this.activeChaos.get(chaosId);
    if (!record || record.status !== 'active') return;

    const isRecovered = await this._verifyRecovery(record);
    
    if (isRecovered) {
      record.status = 'recovered';
      record.recoveredAt = Date.now();
      record.recoveryTime = record.recoveredAt - record.injectedAt;
      
      this.metrics.totalRecovered++;
      this._updateAverageRecoveryTime(record.recoveryTime);
      
      this._log('info', 'Sentinel recovered from chaos', {
        chaos_id: chaosId,
        recoveryTime: record.recoveryTime
      });
      
      this.emit('recovered', { chaos_id: chaosId, record });
    } else {
      record.retryCount++;
      
      if (record.retryCount >= 3) {
        record.status = 'failed';
        this.metrics.totalFailed++;
        
        this._log('error', 'Sentinel failed to recover', { chaos_id: chaosId });
        this.emit('recoveryFailed', { chaos_id: chaosId, record });
        
        if (record.severity === SEVERITY.CRITICAL) {
          await this.panicButton(chaosId);
        }
      } else {
        // Retry verification
        this._log('warn', 'Recovery verification retry', { 
          chaos_id: chaosId, 
          attempt: record.retryCount 
        });
        setTimeout(() => this._evaluateRecovery(chaosId), 10000);
      }
    }

    if (record.status !== 'active') {
      this.chaosHistory.push(record);
      this.activeChaos.delete(chaosId);
    }
  }

  async _verifyRecovery(record) {
    try {
      switch (record.domain) {
        case CHAOS_DOMAINS.NETWORKING:
          return await this._verifyNetworkRecovery(record);
        case CHAOS_DOMAINS.COMMERCE:
          return await this._verifyCommerceRecovery(record);
        default:
          return false;
      }
    } catch (error) {
      this._log('error', 'Recovery verification error', { 
        chaos_id: record.chaos_id, 
        error: error.message 
      });
      return false;
    }
  }

  async _verifyNetworkRecovery(record) {
    const { conn, release } = await this.connectionPool.getConnection(this.config);
    
    try {
      switch (record.type) {
        case 'dropFirewallRules': {
          const currentRules = await conn.menu('/ip firewall filter').getAll();
          
          // Verify by fingerprint, not ephemeral ID
          const currentFingerprints = currentRules
            .filter(r => r.disabled !== 'true')
            .map(r => this._createRuleFingerprint(r));
          
          const missingFingerprints = record.originalState.ruleFingerprints
            .filter(fp => !currentFingerprints.includes(fp));
          
          return missingFingerprints.length === 0;
        }
        
        case 'throttleBandwidth': {
          const queues = await conn.menu('/queue simple').getAll();
          return !queues.some(q => q.name === 'CHAOS_THROTTLE');
        }
        
        case 'ghostAPI': {
          // Verify by attempting normal operation
          try {
            await conn.menu('/system resource').getAll();
            return true;
          } catch {
            return false;
          }
        }
        
        default:
          return false;
      }
    } finally {
      release();
    }
  }

  async _verifyCommerceRecovery(record) {
    switch (record.type) {
      case 'corruptIndexedDB': {
        try {
          const catalog = await this._readCommerceCatalog();
          // Verify no corruption markers present
          return !catalog.__chaos_id && !catalog._corruptionMarker;
        } catch {
          return false;
        }
      }
      
      case 'latencies': {
        const start = Date.now();
        await this._quickFirestoreTest();
        return (Date.now() - start) < 1000;
      }
      
      default:
        return false;
    }
  }

  // ==================== NETWORKING DISRUPTIONS (FIXED) ====================

  async dropFirewallRules(options = {}) {
    const chaosId = this._generateChaosId(CHAOS_DOMAINS.NETWORKING, 'dropFirewallRules');
    
    if (this.config.dryRun) {
      return { chaos_id: chaosId, status: 'dry_run' };
    }

    await this.initialize();
    this._log('info', 'Injecting: dropFirewallRules', { chaos_id: chaosId });

    const { conn, release } = await this.connectionPool.getConnection(this.config);
    
    try {
      const allRules = await conn.menu('/ip firewall filter').getAll();
      const activeRules = allRules.filter(r => r.disabled !== 'true');
      
      if (activeRules.length < 3) {
        throw new Error(`Insufficient active rules: ${activeRules.length}`);
      }

      // Select and disable 3 random rules
      const targets = activeRules
        .sort(() => 0.5 - Math.random())
        .slice(0, 3);

      // Store fingerprints for reliable restoration
      const originalState = {
        rules: targets.map(r => ({ ...r })),
        ruleFingerprints: targets.map(r => this._createRuleFingerprint(r)),
        timestamp: Date.now()
      };

      // Disable rules
      for (const rule of targets) {
        await conn.menu('/ip firewall filter').set({
          '.id': rule['.id'],
          disabled: 'yes'
        });
      }

      const record = this._recordChaos(
        chaosId,
        CHAOS_DOMAINS.NETWORKING,
        'dropFirewallRules',
        originalState,
        async () => this._restoreFirewallRules(originalState)
      );

      return {
        chaos_id: chaosId,
        domain: CHAOS_DOMAINS.NETWORKING,
        type: 'dropFirewallRules',
        disabled_count: targets.length,
        recovery_window_ms: this.config.recoveryWindow,
        status: 'active'
      };

    } finally {
      release();
    }
  }

  async throttleBandwidth(options = {}) {
    const chaosId = this._generateChaosId(CHAOS_DOMAINS.NETWORKING, 'throttleBandwidth');
    
    if (this.config.dryRun) {
      return { chaos_id: chaosId, status: 'dry_run' };
    }

    await this.initialize();
    this._log('info', 'Injecting: throttleBandwidth', { chaos_id: chaosId });

    const { conn, release } = await this.connectionPool.getConnection(this.config);

    try {
      const originalQueues = await conn.menu('/queue simple').getAll();

      await conn.menu('/queue simple').add({
        name: 'CHAOS_THROTTLE',
        target: '0.0.0.0/0',
        'max-limit': '64k/64k',
        priority: '1',
        comment: `CHAOS:${chaosId}`
      });

      const record = this._recordChaos(
        chaosId,
        CHAOS_DOMAINS.NETWORKING,
        'throttleBandwidth',
        { queues: originalQueues, timestamp: Date.now() },
        async () => this._removeThrottleQueue()
      );

      return {
        chaos_id: chaosId,
        domain: CHAOS_DOMAINS.NETWORKING,
        type: 'throttleBandwidth',
        throttle_limit: '64k/64k',
        recovery_window_ms: this.config.recoveryWindow,
        status: 'active'
      };

    } finally {
      release();
    }
  }

  async ghostAPI(options = {}) {
    const chaosId = this._generateChaosId(CHAOS_DOMAINS.NETWORKING, 'ghostAPI');
    
    if (this.config.dryRun) {
      return { chaos_id: chaosId, status: 'dry_run' };
    }

    await this.initialize();
    this._log('info', 'Injecting: ghostAPI', { chaos_id: chaosId });

    // Create ghost connection through pool
    const { conn, id, release } = this.connectionPool.createGhostConnection(this.config);
    
    try {
      await conn.connect();
      
      // Start hanging operation with timeout protection
      const hangTimeout = setTimeout(() => {
        // Force cleanup after 30s even if hanging
        this.connectionPool.destroyGhost(id).catch(() => {});
      }, 30000);

      // Start infinite ping
      const hangingPromise = conn.menu('/ping')
        .where({ address: '127.0.0.1', count: 0 })
        .get();
      
      // Don't await - let it hang, but track it
      hangingPromise.catch(() => {
        clearTimeout(hangTimeout);
      });

      const record = this._recordChaos(
        chaosId,
        CHAOS_DOMAINS.NETWORKING,
        'ghostAPI',
        { connectionId: id, timestamp: Date.now() },
        async () => {
          clearTimeout(hangTimeout);
          await this.connectionPool.destroyGhost(id);
        }
      );

      // Store reference for cleanup tracking
      record.ghostConnectionId = id;

      return {
        chaos_id: chaosId,
        domain: CHAOS_DOMAINS.NETWORKING,
        type: 'ghostAPI',
        connection_id: id,
        recovery_window_ms: this.config.recoveryWindow,
        status: 'active'
      };

    } catch (error) {
      await this.connectionPool.destroyGhost(id);
      throw error;
    }
  }

  // ==================== COMMERCE DISRUPTIONS (FIXED) ====================

  async corruptIndexedDB(options = {}) {
    const chaosId = this._generateChaosId(CHAOS_DOMAINS.COMMERCE, 'corruptIndexedDB');
    
    if (this.config.dryRun) {
      return { chaos_id: chaosId, status: 'dry_run' };
    }

    await this.initialize();
    this._log('info', 'Injecting: corruptIndexedDB', { chaos_id: chaosId });

    const originalCatalog = await this._readCommerceCatalog();
    
    // Atomic write with temp file
    const catalogPath = path.join(process.cwd(), 'data', 'commerce_catalog.json');
    const tempPath = `${catalogPath}.tmp.${chaosId}`;

    const corruption = {
      __chaos_id: chaosId,
      __injected_at: new Date().toISOString(),
      data: {
        products: null,
        prices: undefined,
        metadata: {
          corrupted: true,
          payload: "{invalid json: missing closing brace"
        }
      },
      _corruptionMarker: crypto.randomBytes(16).toString('hex')
    };

    try {
      // Write to temp first, then rename (atomic)
      await fs.writeFile(tempPath, JSON.stringify(corruption, null, 2));
      await fs.rename(tempPath, catalogPath);

      const record = this._recordChaos(
        chaosId,
        CHAOS_DOMAINS.COMMERCE,
        'corruptIndexedDB',
        { catalog: originalCatalog, timestamp: Date.now() },
        async () => this._restoreCommerceCatalog(originalCatalog)
      );

      return {
        chaos_id: chaosId,
        domain: CHAOS_DOMAINS.COMMERCE,
        type: 'corruptIndexedDB',
        recovery_window_ms: this.config.recoveryWindow,
        status: 'active'
      };

    } catch (error) {
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  }

  async latencies(options = {}) {
    const chaosId = this._generateChaosId(CHAOS_DOMAINS.COMMERCE, 'latencies');
    
    if (this.config.dryRun) {
      return { chaos_id: chaosId, status: 'dry_run' };
    }

    await this.initialize();
    this._log('info', 'Injecting: latencies', { chaos_id: chaosId });

    if (!this.config.firestoreInstance) {
      throw new Error('Firestore instance not provided in config');
    }

    // Create and install real interceptor
    const interceptor = new FirestoreInterceptor(
      this.config.firestoreInstance, 
      options.delayMs || 5000
    );
    
    interceptor.install();
    this.firestoreInterceptors.set(chaosId, interceptor);

    const record = this._recordChaos(
      chaosId,
      CHAOS_DOMAINS.COMMERCE,
      'latencies',
      { interceptor, timestamp: Date.now() },
      async () => {
        interceptor.uninstall();
        this.firestoreInterceptors.delete(chaosId);
      }
    );

    return {
      chaos_id: chaosId,
      domain: CHAOS_DOMAINS.COMMERCE,
      type: 'latencies',
      delay_ms: options.delayMs || 5000,
      recovery_window_ms: this.config.recoveryWindow,
      status: 'active'
    };
  }

  // ==================== SAFETY SWITCH (FIXED WITH MUTEX) ====================

  async panicButton(specificChaosId = null) {
    const release = await this.panicMutex.acquire();
    const panicId = `panic-${uuidv4().split('-')[0]}`;
    
    try {
      this._log('critical', 'PANIC BUTTON ACTIVATED', { 
        panic_id: panicId,
        specific_chaos_id: specificChaosId
      });

      const results = {
        panic_id: panicId,
        timestamp: new Date().toISOString(),
        restorations: [],
        failures: []
      };

      const targets = specificChaosId 
        ? [[specificChaosId, this.activeChaos.get(specificChaosId)]].filter(([,r]) => r)
        : Array.from(this.activeChaos.entries());

      // Execute recoveries
      for (const [chaosId, record] of targets) {
        try {
          if (record.recoveryFn) {
            await record.recoveryFn();
            record.status = 'panic_restored';
            results.restorations.push({ chaos_id: chaosId, status: 'success' });
            
            if (record.timeoutRef) clearTimeout(record.timeoutRef);
            this.activeChaos.delete(chaosId);
          }
        } catch (error) {
          results.failures.push({ chaos_id: chaosId, error: error.message });
          this._log('error', 'Panic restoration failed', { 
            panic_id: panicId,
            chaos_id: chaosId,
            error: error.message
          });
        }
      }

      // Final safety net: restore from backup
      await this._restoreFromBackup();

      this.emit('panicRestored', results);
      return results;

    } finally {
      release();
    }
  }

  // ==================== RECOVERY FUNCTIONS (FIXED) ====================

  async _restoreFirewallRules(originalState) {
    const { conn, release } = await this.connectionPool.getConnection(this.config);
    
    try {
      const currentRules = await conn.menu('/ip firewall filter').getAll();
      
      // Match by fingerprint, enable matching rules
      for (const rule of currentRules) {
        const fp = this._createRuleFingerprint(rule);
        if (originalState.ruleFingerprints.includes(fp) && rule.disabled === 'true') {
          await conn.menu('/ip firewall filter').set({
            '.id': rule['.id'],
            disabled: 'no'
          });
        }
      }
    } finally {
      release();
    }
  }

  async _removeThrottleQueue() {
    const { conn, release } = await this.connectionPool.getConnection(this.config);
    
    try {
      const queues = await conn.menu('/queue simple').getAll();
      const throttle = queues.find(q => q.name === 'CHAOS_THROTTLE');
      if (throttle) {
        await conn.menu('/queue simple').remove(throttle['.id']);
      }
    } finally {
      release();
    }
  }

  async _restoreCommerceCatalog(originalCatalog) {
    const catalogPath = path.join(process.cwd(), 'data', 'commerce_catalog.json');
    const tempPath = `${catalogPath}.tmp.restore`;
    
    await fs.writeFile(tempPath, JSON.stringify(originalCatalog, null, 2));
    await fs.rename(tempPath, catalogPath);
  }

  async _restoreFromBackup() {
    if (!this.lastKnownGoodState) return;
    
    // Parallel restoration with error isolation
    const tasks = [];
    
    if (this.lastKnownGoodState.firewall?.ruleFingerprints?.length > 0) {
      tasks.push(this._restoreFirewallRules(this.lastKnownGoodState.firewall));
    }
    
    if (this.lastKnownGoodState.commerce?.catalog) {
      tasks.push(this._restoreCommerceCatalog(this.lastKnownGoodState.commerce.catalog));
    }
    
    await Promise.allSettled(tasks);
  }

  // ==================== UTILITY METHODS (FIXED) ====================

  async _readCommerceCatalog() {
    const catalogPath = path.join(process.cwd(), 'data', 'commerce_catalog.json');
    try {
      const data = await fs.readFile(catalogPath, 'utf8');
      return JSON.parse(data);
    } catch {
      return { products: [], version: '1.0.0' };
    }
  }

  async _quickFirestoreTest() {
    if (!this.config.firestoreInstance) return;
    // Minimal read operation to test latency
    await this.config.firestoreInstance.collection('_chaos_test').doc('ping').get()
      .catch(() => {}); // Ignore missing doc error
  }

  _updateAverageRecoveryTime(newTime) {
    if (this.metrics.totalRecovered === 0) {
      this.metrics.averageRecoveryTime = newTime;
    } else {
      const total = this.metrics.totalRecovered;
      this.metrics.averageRecoveryTime = 
        ((this.metrics.averageRecoveryTime * (total - 1)) + newTime) / total;
    }
    this.metrics.lastRecoveredAt = Date.now();
  }

  // ==================== PUBLIC API ====================

  arm() {
    if (!this._initialized) {
      throw new Error('ChaosMonkey not initialized. Call initialize() first.');
    }
    this.isArmed = true;
    this._log('info', 'Chaos Monkey ARMED');
    this.emit('armed');
  }

  disarm() {
    this.isArmed = false;
    this._log('info', 'Chaos Monkey DISARMED');
    this.emit('disarmed');
  }

  getStatus() {
    return {
      armed: this.isArmed,
      initialized: this._initialized,
      activeChaos: Array.from(this.activeChaos.entries()).map(([id, r]) => ({
        chaos_id: id,
        domain: r.domain,
        type: r.type,
        status: r.status,
        timeRemaining: Math.max(0, r.expiresAt - Date.now())
      })),
      metrics: { ...this.metrics },
      poolStatus: {
        total: this.connectionPool.pool.size,
        inUse: this.connectionPool.inUse.size,
        ghosts: this.connectionPool.ghostConnections.size
      }
    };
  }

  async destroy() {
    // Cleanup all resources
    await this.panicButton();
    await this.connectionPool.destroyAll();
    
    // Uninstall all interceptors
    for (const [id, interceptor] of this.firestoreInterceptors) {
      interceptor.uninstall();
    }
    this.firestoreInterceptors.clear();
    
    this.removeAllListeners();
    this._initialized = false;
  }
}

module.exports = {
  ChaosMonkey,
  CHAOS_DOMAINS,
  SEVERITY,
  createChaosMonkey: (config) => new ChaosMonkey(config)
};
