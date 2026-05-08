/**
 * AgentOS
 * @module core/mikrotik
 * @version 2026.04.14
 */
// ── Imports ───────────────────────────────────────────────────────────────────
const { RouterOSClient } = require('routeros-client');
const { logger } = require('./logger');
const { getConfig } = require('./config');
const NodeCache = require('node-cache');
const Joi = require('joi');
const EventEmitter = require('events');

// ── Input schemas ─────────────────────────────────────────────────────────────
const toolSchemas = {
    'ping': Joi.object({
        host: Joi.string().hostname().required(),
        count: Joi.number().integer().min(1).max(100).default(4)
    }),
    'user.add': Joi.object({
        username: Joi.string().alphanum().min(3).max(50).required(),
        password: Joi.string().min(4).required(),
        profile: Joi.string().valid('default', '1Hour', '1Day', '7Day', '30Day').default('default'),
        limitUptime: Joi.string().allow('', null)
    }),
    'hotspot.profile.update': Joi.object({
        name: Joi.string().required(),
        sharedUsers: Joi.number().integer().min(1).optional(),
        rateLimit: Joi.string().allow('', null).optional(),
        sessionTimeout: Joi.string().allow('', null).optional(),
        idleTimeout: Joi.string().allow('', null).optional()
    })
};
// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 30_000;
const RECONNECT_INTERVAL = 5_000;
const MAX_RECONNECT_ATTEMPTS = 10;
const HEARTBEAT_INTERVAL = 30_000;

// ── Error Classes ─────────────────────────────────────────────────────────────


class MikroTikError extends Error {
    constructor(message, code, originalError = null) {
        super(message);
        this.name = 'MikroTikError';
        this.code = code;
        this.originalError = originalError;
        this.timestamp = new Date().toISOString();
    }
}

class ConnectionError extends MikroTikError {
    constructor(message, originalError = null) {
        super(message, 'CONNECTION_ERROR', originalError);
        this.name = 'ConnectionError';
    }
}

class ToolExecutionError extends MikroTikError {
    constructor(toolName, message, originalError = null) {
        super(`Tool '${toolName}' failed: ${message}`, 'TOOL_ERROR', originalError);
        this.name = 'ToolExecutionError';
        this.toolName = toolName;
    }
}

// ── Circuit Breaker ───────────────────────────────────────────────────────────

class CircuitBreaker {
    constructor(threshold = 10, timeout = 120_000) {
        this.failures = 0;
        this.threshold = threshold;
        this.timeout = timeout;
        this.state = 'CLOSED'; // CLOSED | OPEN | HALF_OPEN
        this.nextAttempt = Date.now();
    }

    async execute(fn) {
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                throw new Error('Circuit breaker is OPEN — refusing request');
            }
            this.state = 'HALF_OPEN';
        }

        try {
            const result = await fn();
            this._onSuccess();
            return result;
        } catch (error) {
            this._onFailure(error);
            throw error;
        }
    }

    _onSuccess() {
        this.failures = 0;
        this.state = 'CLOSED';
    }

    _onFailure(error) {
        // Only trip on systemic errors (timeouts, connection drops, auth failures)
        const systemicErrors = ['timeout', 'interrupted', 'connection', 'logged in', 'econnreset', 'etimedout'];
        const isSystemic = systemicErrors.some(keyword => error?.message?.toLowerCase().includes(keyword));

        if (!isSystemic && this.state !== 'OPEN') {
            logger.debug(`CircuitBreaker ignoring non-systemic failure: ${error?.message}`);
            return;
        }

        this.failures++;
        if (this.failures >= this.threshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.timeout;
            logger.warn(`CircuitBreaker OPEN — tripped by: ${error?.message || 'Unknown error'}. Will retry after ${this.timeout}ms`);
        } else {
            logger.debug(`CircuitBreaker failure ${this.failures}/${this.threshold}: ${error?.message || 'Unknown error'}`);
        }
    }
}

// ── MikroTik Manager ──────────────────────────────────────────────────────────


class MikroTikManager extends EventEmitter {
    constructor(options = {}) {
        super();
        this.cache = new NodeCache({ stdTTL: 30, checkperiod: 60 });
        const globalConfig = getConfig();
        const mikrotikConfig = globalConfig.tools?.mikrotik?.connection || globalConfig.adapters?.mikrotik || globalConfig.mikrotik || {};

        this.config = {
            host: options.host || options.ip || mikrotikConfig.host || mikrotikConfig.ip || '192.168.88.1',
            user: options.user || mikrotikConfig.username || mikrotikConfig.user || 'admin',
            password: options.password || options.pass || mikrotikConfig.password || mikrotikConfig.pass || '',
            port: options.port || mikrotikConfig.port || 8728,
            timeout: options.timeout || DEFAULT_TIMEOUT
        };

        this.state = {
            conn: null,
            isConnected: false,
            reconnectAttempts: 0,
            lastError: null,
            lastConnectedAt: null,
            lastKnownHealth: {} // Persist last known health for reboots
        };

        this.intervals = { heartbeat: null, reconnect: null };

        this.circuitBreaker = new CircuitBreaker();

        this.tools = new Map();
        this._registerTools();
        this._handleDisconnect = this._handleDisconnect.bind(this);
        this._heartbeat = this._heartbeat.bind(this);
    }

    _getId(obj) {
        if (!obj) return null;

        // Pass 1: try all known key names used by different routeros-client versions.
        // Use != null so empty-string is still caught below, but 0 wouldn't short-circuit.
        for (const key of ['.id', 'id', '$$id', '*id']) {
            const val = obj[key];
            if (val != null && val !== '') return String(val);
        }

        // Pass 2: last-resort value scan — find the RouterOS internal *HEX id
        // regardless of which property key the client chose to store it under.
        for (const val of Object.values(obj)) {
            if (typeof val === 'string' && /^\*[0-9A-Fa-f]+$/i.test(val)) {
                return val;
            }
        }

        if (obj.name || obj.user) {
            logger.debug(`[MikroTik] _getId: no ID for '${obj.name || obj.user}'. Keys: [${Object.keys(obj).join(', ')}]`);
        }
        return null;
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._clearIntervals();

        if (this.state.client) {
            this.state.client.removeAllListeners();
            try {
                this.state.client.disconnect();
            } catch (e) {
                logger.warn('MikroTik disconnect error during destroy:', e.message);
            }
            this.state.client = null;
        }

        this.state.conn = null;
        this.state.isConnected = false;
        this.removeAllListeners();
        logger.debug('MikroTik manager destroyed');
    }

    get isConnected() {
        return this.state.isConnected;
    }

    get conn() {
        return this.state.conn;
    }

    get isCircuitOpen() {
        return this.circuitBreaker.state === 'OPEN' && Date.now() < this.circuitBreaker.nextAttempt;
    }

    // ── Tool Registry ─────────────────────────────────────────────────────────



    _registerTools() {
        const tools = [
            // Hotspot User Management
            ['user.add', this.addHotspotUser],
            ['user.remove', this.removeHotspotUser],
            ['user.kick', this.kickUser],
            ['user.status', this.getUserStatus],
            ['user.stat', this.getUserStats],
            ['user.stats', this.getUserStats],
            ['user.edit', this.editHotspotUser],
            ['user.disable', this.disableHotspotUser],
            ['user.enable', this.enableHotspotUser],
            ['user.active', this.getActiveUsers],
            ['users.active', this.getActiveUsers],
            ['users.report', this.getUserReport],
            ['users.all', this.getAllHotspotUsers],
            ['hotspot.profiles', this.getHotspotProfiles],
            ['profile.list', this.getHotspotProfiles],
            ['hotspot.profile.update', this.updateHotspotProfile],
            ['profile.update', this.updateHotspotProfile],

            // System
            ['system.stats', this.getSystemStats],
            ['system.resources', this.getSystemResources],
            ['system.uptime', this.getUptime],
            ['system.identity', this.getIdentity],
            ['system.health', this.getSystemHealth],
            ['system.logs', this.getLogs],
            ['system.reboot', this.reboot],
            ['system.shutdown', this.shutdown],
            ['system.backup', this.createBackup],

            // Network Tools
            ['ping', this.ping],
            ['traceroute', this.traceroute],
            ['speedtest', this.speedtest],
            ['bandwidth', this.bandwidth],
            ['flood', this.flood],
            ['sniff', this.sniff],
            ['dns.flush', this.flushDnsCache],

            // Network Info
            ['ip.addresses', this.getIpAddresses],
            ['ip.routes', this.getRoutes],
            ['dns', this.getDnsSettings],
            ['dhcp.leases', this.getDhcpLeases],
            ['interface.list', this.getInterfaces],
            ['arp.table', this.getArpTable],
            ['system.neighbors', this.getNeighbors],

            // Firewall
            ['firewall.list', this.getFirewallRules],
            ['firewall.summary', this.getFirewallSummary],
            ['firewall.connections', this.getActiveConnections],
            ['firewall.block', this.addToBlockList],
            ['firewall.unblock', this.removeFromBlockList],
            ['nat.list', this.getNatRules],
            ['cli.execute', this.executeCLI],
            ['api.raw', this.executeRawAPI],
            ['vouchers.cleanup', this.cleanupExpiredVouchers],
            ['system.full_stats', this.getFullSystemStats],
        ];

        for (const [name, fn] of tools) {
            this.tools.set(name, fn.bind(this));
        }
    }
    // ── Connection Management ─────────────────────────────────────────────────


    async connect() {
        if (this.state.isConnected) {
            logger.debug('Already connected to MikroTik');
            return true;
        }

        try {
            logger.info(`Connecting to MikroTik at ${this.config.host}:${this.config.port}`);

            const client = new RouterOSClient({
                host: this.config.host,
                user: this.config.user,
                password: this.config.password,
                port: this.config.port,
                timeout: this.config.timeout
            });

            this.state.client = client;

            // Add listeners to the client instance (EventEmitter)
            client.on('error', (err) => {
                if (this.state.isConnected) {
                    logger.error(`MikroTik connection error: ${err.message}`);
                    this._handleDisconnect(err);
                }
            });

            client.on('close', () => {
                if (this.state.isConnected) {
                    logger.warn('MikroTik connection closed by peer');
                    this._handleDisconnect(new Error('Connection closed by peer'));
                }
            });

            this.state.conn = await client.connect();
            this.state.isConnected = true;
            this.state.reconnectAttempts = 0;
            this.state.lastConnectedAt = new Date().toISOString();
            this.state.lastError = null;

            this._startHeartbeat();
            this.emit('connected', { host: this.config.host, timestamp: this.state.lastConnectedAt });

            // Sync state to Firestore
            this._syncState();

            logger.info('✅ MikroTik connected successfully');
            return true;

        } catch (error) {
            this.state.isConnected = false;
            this.state.lastError = error;

            const connError = new ConnectionError(
                `Failed to connect to MikroTik: ${error.message}`,
                error
            );

            logger.error(connError.message);
            this.emit('connectionFailed', connError);
            this._scheduleReconnect();
            return false;
        }
    }

    disconnect() {
        // Guard: skip if already disconnected to prevent duplicate log noise
        if (!this.state.isConnected && !this.state.client) {
            logger.debug('MikroTik already disconnected — skipping duplicate disconnect call');
            return;
        }
        logger.info('Disconnecting from MikroTik...');
        this._clearIntervals();

        if (this.state.client) {
            this.state.client.removeAllListeners();
            try { this.state.client.disconnect(); } catch (e) { logger.warn('Close error:', e.message); }
            this.state.client = null;
        }

        this.state.conn = null;
        this.state.isConnected = false;
        this.emit('disconnected', { timestamp: new Date().toISOString() });
        logger.info('🔌 MikroTik disconnected');
    }

    async reconnect() {
        logger.info('Forcing reconnection...');
        this.disconnect();
        return this.connect();
    }

    // ── Heartbeat & Reconnect ─────────────────────────────────────────────────

    _startHeartbeat() {
        this._clearIntervals();
        this.intervals.heartbeat = setInterval(this._heartbeat, HEARTBEAT_INTERVAL);
        this.intervals.heartbeat.unref?.();
    }

    async _heartbeat() {
        if (!this.state.isConnected || !this.state.conn) return;
        try {
            // Heartbeat now fetches health to keep 'voltage' and 'cpu' updated
            const health = await this.getSystemHealth();
            this.state.lastKnownHealth = health; // Update last known health
            this.emit('healthUpdate', health);
        } catch (error) {
            logger.warn('Heartbeat failed — connection lost');
            this._handleDisconnect(error);
        }
    }

    _handleDisconnect(error) {
        if (!this.state.isConnected && !this.state.conn) return;

        this.state.isConnected = false;
        this.state.lastError = error;

        // Clean up connection resources
        if (this.state.client) {
            this.state.client.removeAllListeners();
            try { this.state.client.disconnect(); } catch (_) { }
            this.state.client = null;
        }
        this.state.conn = null;

        this._clearIntervals();

        this.emit('connectionLost', { error: error.message, timestamp: new Date().toISOString() });
        this._syncState();
        this._scheduleReconnect();
    }

    /**
     * Safely retrieves the underlying raw RouterOSAPI instance.
     * @returns {RouterOSAPI}
     * @private
     */
    _getRawApi() {
        // Try getting it from the menu connection first
        if (this.state.conn && this.state.conn.rosApi) {
            return this.state.conn.rosApi;
        }
        // Fallback to the client instance
        if (this.state.client && this.state.client.rosApi) {
            return this.state.client.rosApi;
        }
        return null;
    }

    /**
     * Performs a raw write to the MikroTik API with connection re-validation.
     * Fixes 'write is not a function' errors by ensuring the correct API object is used.
     * @param {string[]} parts Command parts
     * @returns {Promise<any>}
     * @private
     */
    async _writeRaw(parts) {
        this._ensureConnected();

        const rawApi = this._getRawApi();
        if (!rawApi || typeof rawApi.write !== 'function') {
            logger.error('[MikroTik] _writeRaw: No valid raw API found or write method missing', {
                hasConn: !!this.state.conn,
                hasClient: !!this.state.client,
                connType: this.state.conn ? typeof this.state.conn : 'null'
            });
            throw new ConnectionError('MikroTik write interface unavailable (connection may be transitioning)');
        }

        try {
            return await rawApi.write(parts);
        } catch (err) {
            if (err.message?.includes('not connected') || err.message?.includes('closed')) {
                this._handleDisconnect(err);
            }
            throw err;
        }
    }

    async _syncState() {
        try {
            const { getDatabase } = require('./database');
            const db = await getDatabase();
            if (db) {
                // Fetch latest health before syncing
                const health = this.state.isConnected ? await this.getSystemHealth().catch(() => ({})) : {};
                await db.updateMikrotikState('default', {
                    ...this.getState(),
                    health
                });
            }
        } catch (err) {
            logger.warn('Failed to sync MikroTik state:', err.message);
        }
    }

    _scheduleReconnect() {
        if (this.state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            logger.error(`Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached`);
            this.emit('maxReconnectReached', { attempts: this.state.reconnectAttempts });
            return;
        }

        this.state.reconnectAttempts++;
        const delay = Math.min(RECONNECT_INTERVAL * Math.pow(2, this.state.reconnectAttempts - 1), 60_000);
        logger.info(`Scheduling reconnect ${this.state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);

        this.intervals.reconnect = setTimeout(() => {
            this.connect().catch(err => logger.error('Scheduled reconnect failed:', err.message));
        }, delay);
        this.intervals.reconnect.unref?.();
    }

    _clearIntervals() {
        if (this.intervals.heartbeat) {
            clearInterval(this.intervals.heartbeat);
            this.intervals.heartbeat = null;
        }
        if (this.intervals.reconnect) {
            clearTimeout(this.intervals.reconnect);
            this.intervals.reconnect = null;
        }
    }

    // ── Guard ─────────────────────────────────────────────────────────────────

    _ensureConnected() {
        if (!this.state.isConnected || !this.state.client || !this.state.conn) {
            const reason = !this.state.isConnected ? 'not marked as connected' :
                !this.state.client ? 'client is null' : 'connection handler is null';
            throw new ConnectionError(`MikroTik not connected (${reason}). Connection may have dropped or rebooted.`);
        }

        // Verify it's a valid RosApiMenu instance (should have .menu function)
        if (typeof this.state.conn.menu !== 'function') {
            logger.error('[MikroTik] Invalid connection state: this.state.conn is not a RosApiMenu handler', {
                type: typeof this.state.conn,
                keys: Object.keys(this.state.conn)
            });
            throw new ConnectionError('MikroTik connection handler is invalid');
        }
    }

    // ── Tool Execution ────────────────────────────────────────────────────────

    async executeTool(toolName, ...args) {
        let params = args[0] || {};

        const schema = toolSchemas[toolName];
        if (schema && typeof params === 'object' && !Array.isArray(params)) {
            const { error, value } = schema.validate(params);
            if (error) throw new ToolExecutionError(toolName, `Invalid params: ${error.message}`);
            params = value;
        }

        return this.circuitBreaker.execute(async () => {
            this._ensureConnected();

            const tool = this.tools.get(toolName);
            if (!tool) {
                throw new ToolExecutionError(
                    toolName,
                    `Tool not found. Available: ${this.getAvailableTools().join(', ')}`
                );
            }

            try {
                const startTime = Date.now();
                // Support both positional and object-based args
                const result = (typeof params === 'object' && !Array.isArray(params) && tool.length === 1)
                    ? await tool(params)
                    : await tool(...args);

                const duration = Date.now() - startTime;

                this.emit('toolExecuted', { tool: toolName, duration, params });
                return result;
            } catch (error) {
                const toolError = new ToolExecutionError(toolName, error.message || 'Unknown error', error);
                this.emit('toolError', { tool: toolName, error: toolError });
                throw toolError;
            }
        });
    }

    getAvailableTools() {
        return Array.from(this.tools.keys()).sort();
    }

    getState() {
        return {
            isConnected: this.state.isConnected,
            host: this.config.host,
            port: this.config.port,
            reconnectAttempts: this.state.reconnectAttempts,
            lastConnectedAt: this.state.lastConnectedAt,
            lastError: this.state.lastError?.message || null,
            availableTools: this.getAvailableTools().length
        };
    }

    invalidateCache(pattern) {
        this.cache.keys()
            .filter(k => k.includes(pattern))
            .forEach(k => this.cache.del(k));
    }

    _normalizeProfile(profile) {
        if (!profile) return 'default';
        const p = profile.toLowerCase();
        const aliasMap = {
            '1h': '1Hour', '1hour': '1Hour',
            '1d': '1Day', '1day': '1Day', '24h': '1Day', '24hour': '1Day',
            '7d': '7Day', '7day': '7Day', '1w': '7Day', '1week': '7Day',
            '30d': '30Day', '30day': '30Day', '30days': '30Day', '1m': '30Day', '1month': '30Day'
        };
        return aliasMap[p] || profile; // Fallback to original if not in map
    }

    // ── Hotspot User Management ───────────────────────────────────────────────

    async addHotspotUser(usernameOrObj, passwordArg, profileArg = 'default') {
        let username = usernameOrObj;
        let password = passwordArg;
        let profile = profileArg;

        let sharedUsers = 1;

        if (typeof usernameOrObj === 'object' && !passwordArg) {
            username = usernameOrObj.username;
            password = usernameOrObj.password;
            profile = this._normalizeProfile(usernameOrObj.profile || 'default');
            sharedUsers = usernameOrObj.sharedUsers || 1;
        } else {
            profile = this._normalizeProfile(profileArg);
        }


        this._ensureConnected();
        if (!username || !password) {
            throw new ToolExecutionError('user.add', 'Username and password are required');
        }

        // --- Duration & Limits ---
        let limitUptime = null;
        let limitBytesTotal = null;
        let plan = null;

        try {
            const { getDatabase } = require('./database');
            const db = await getDatabase();
            if (db) plan = await db.getPlan(profile);
        } catch (err) {
            logger.warn('Failed to fetch plan from database for limits: ' + err.message);
        }

        if (plan) {
            // RouterOS limit-uptime format:
            //   days/weeks → "Nd" / "Nw"  (e.g. "7d", "1w")  — RouterOS accepts these
            //   hours      → "HH:MM:SS"   (e.g. "01:00:00")  — "1h" is NOT valid
            //   minutes    → "00:MM:00"   (e.g. "00:30:00")
            const val = Math.min(plan.durationValue || 0, 999); // RouterOS cap
            switch (plan.durationUnit) {
                case 'weeks': limitUptime = `${val}w`; break;
                case 'days': limitUptime = `${val}d`; break;
                case 'hours': {
                    const h = String(val).padStart(2, '0');
                    limitUptime = `${h}:00:00`;
                    break;
                }
                case 'minutes': {
                    const totalMin = val;
                    const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
                    const mm = String(totalMin % 60).padStart(2, '0');
                    limitUptime = `${hh}:${mm}:00`;
                    break;
                }
            }

            // Data cap — set limit-bytes-total when plan defines a quota
            if (plan.dataLimit && String(plan.dataLimit).toLowerCase() !== 'unlimited') {
                const numVal = Number(plan.dataLimit);
                if (!isNaN(numVal) && numVal > 0) {
                    limitBytesTotal = `${Math.round(numVal)}M`;
                }
            }
        }

        let dnsName = process.env.HOTSPOT_DNS_NAME || this.config.hotspotDnsName || 'router.lan';
        try {
            const profiles = await this.state.conn.menu('/ip/hotspot/profile').get();
            const defaultProfile = profiles.find(p => p['dns-name']) || profiles[0];
            if (defaultProfile && defaultProfile['dns-name']) {
                dnsName = defaultProfile['dns-name'];
            }
        } catch (err) {
            logger.warn('Could not fetch dns-name for hotspot, using fallback', err.message);
        }

        const loginUrl = `http://${dnsName}/login?username=${username}&password=${password}`;

        const existing = await this.state.conn
            .menu('/ip/hotspot/user')
            .where('name', username)
            .get();

        let id;
        if (existing.length > 0) {
            const targetId = this._getId(existing[0]);
            const updates = {
                password,
                profile,
                disabled: 'no'
            };
            if (limitUptime) updates['limit-uptime'] = limitUptime;
            if (limitBytesTotal) updates['limit-bytes-total'] = limitBytesTotal;

            try {
                await this.state.conn.menu('/ip/hotspot/user').update(targetId, { ...updates });
            } catch (e) {
                const lowerMsg = e.message.toLowerCase();
                if ((lowerMsg.includes('value of profile') || lowerMsg.includes('does not match any value of profile')) && profile !== 'default') {
                    logger.warn(`Profile '${profile}' not found on router during update. Falling back to 'default' for user ${username}`);
                    updates.profile = 'default';
                    await this.state.conn.menu('/ip/hotspot/user').update(targetId, { ...updates });
                } else throw e;
            }
            id = this._getId(existing[0]);
            this.emit('userUpdated', { username, profile, loginUrl });
        } else {
            const userDoc = {
                name: username,
                password,
                profile,
                disabled: 'no'  // ← Ensure newly-created vouchers are active immediately
            };
            if (limitUptime) userDoc['limit-uptime'] = limitUptime;
            if (limitBytesTotal) userDoc['limit-bytes-total'] = limitBytesTotal;

            try {
                id = await this.state.conn.menu('/ip/hotspot/user').add({ ...userDoc });
            } catch (e) {
                // Fallback: if profile doesn't match, try default
                if (e.message.includes('match any value of profile') || e.message.includes('not found')) {
                    logger.warn(`Profile '${profile}' not found on router during creation. Falling back to 'default' for user ${username}`);
                    userDoc.profile = 'default';
                    id = await this.state.conn.menu('/ip/hotspot/user').add({ ...userDoc });
                } else throw e;
            }
            this.emit('userCreated', { username, profile, loginUrl });
        }

        // ── Sync hotspot metadata back to database ────────────────────────────
        try {
            const { getDatabase } = require('./database');
            const db = await getDatabase();
            if (db) {
                // Build the metadata doc at outer scope so both branches can use it
                const userData = {
                    username,
                    password,
                    profile,
                    loginUrl,
                    limitUptime: limitUptime || null,
                    createdAt: new Date().toISOString()
                };

                if (plan) {
                    const msPerUnit = {
                        minutes: 60_000,
                        hours: 3_600_000,
                        days: 86_400_000,
                        weeks: 604_800_000
                    };
                    const durationMs = plan.durationValue * (msPerUnit[plan.durationUnit] || 86_400_000);
                    userData.expiresAt = new Date(Date.now() + durationMs).toISOString();
                    userData.alertScheduled = false;
                }

                if (db.db) {
                    // Merge into /vouchers/<code> — do NOT write to /users/<voucher-code>
                    // because that creates ghost user documents keyed by the voucher code.
                    await db.db.collection('vouchers').doc(username).set(
                        { loginUrl, limitUptime: userData.limitUptime || null, expiresAt: userData.expiresAt || null },
                        { merge: true }
                    );
                    logger.info(`Hotspot metadata merged into vouchers/${username}`);
                } else {
                    // Local in-memory fallback — update the vouchers map, not _users
                    if (db._vouchers) {
                        const existing = db._vouchers.get(username) || {};
                        db._vouchers.set(username, {
                            ...existing,
                            loginUrl,
                            limitUptime: userData.limitUptime || null,
                            expiresAt: userData.expiresAt || null
                        });
                        db._saveLocal('vouchers');
                    }
                }
            }
        } catch (err) {
            logger.error(`Error saving hotspot user metadata: ${err.message}`);
        }

        return loginUrl;
    }


    async getHotspotProfiles() {
        this._ensureConnected();
        try {
            const profiles = await this.state.conn.menu('/ip/hotspot/user/profile').get();
            return profiles.map(p => ({
                id: this._getId(p),
                name: p.name,
                sharedUsers: p.sharedUsers || p['shared-users'] || 1,
                rateLimit: p.rateLimit || p['rate-limit'] || '',
                statusAutorefresh: p.statusAutorefresh || p['status-autorefresh'] || 'none',
                sessionTimeout: p.sessionTimeout || p['session-timeout'] || 'unlimited',
                idleTimeout: p.idleTimeout || p['idle-timeout'] || 'unlimited'
            }));
        } catch (err) {
            throw new ToolExecutionError('hotspot.profiles', 'Failed to fetch hotspot profiles: ' + err.message);
        }
    }

    async updateHotspotProfile(params = {}) {
        const { name, sharedUsers, rateLimit, sessionTimeout, idleTimeout } = params;
        this._ensureConnected();
        try {
            const update = {};
            if (sharedUsers !== undefined) update['shared-users'] = sharedUsers;
            if (rateLimit !== undefined) update['rate-limit'] = rateLimit;
            if (sessionTimeout !== undefined) update['session-timeout'] = sessionTimeout;
            if (idleTimeout !== undefined) update['idle-timeout'] = idleTimeout;

            if (Object.keys(update).length === 0) return { status: 'no_changes', name };

            // We use .where('name', name) for robustness as seen in apply_setup.js
            const menu = this.state.conn.menu('/ip/hotspot/user/profile');
            const items = await menu.where('name', name).get();

            if (items.length === 0) {
                // If not found, try to create it if name is one of our defaults
                const defaults = ['1Hour', '1Day', '7Day', '30Day', 'trial'];
                if (defaults.includes(name)) {
                    await menu.add({ name, ...update });
                    return { status: 'created', name, update };
                }
                throw new Error(`Profile '${name}' not found and is not a default profile`);
            }

            await menu.where('name', name).update(update);
            return { status: 'updated', name, update };
        } catch (err) {
            throw new ToolExecutionError('hotspot.profile.update', `Failed to update profile '${name}': ${err.message}`);
        }
    }

    async getSystemResource() {
        this._ensureConnected();
        try {
            const resources = await this.state.conn.menu('/system/resource').get();
            return resources[0] || {};
        } catch (err) {
            throw new ToolExecutionError('system.resource', 'Failed to fetch system resources: ' + err.message);
        }
    }

    async removeHotspotUser(usernameOrObj) {
        let username = typeof usernameOrObj === 'object' ? (usernameOrObj.username || usernameOrObj.target || usernameOrObj.id) : usernameOrObj;

        this._ensureConnected();
        if (!username) throw new ToolExecutionError('user.remove', 'Username required');

        const users = await this.state.conn
            .menu('/ip/hotspot/user')
            .where('name', username)
            .get();

        if (users.length === 0) {
            logger.warn(`MikroTikManager: User '${username}' not found on router during removal attempt.`);
            return { action: 'ignored', reason: 'not_found', username };
        }

        const user = users[0];
        const id = this._getId(user);

        if (!id) {
            logger.error(`MikroTikManager: Found user '${username}' but missing ID. User object: ${JSON.stringify(user)}`);
            return { action: 'failed', reason: 'missing_id', username, user };
        }

        await this.state.conn.menu('/ip/hotspot/user').remove(id);
        this.emit('userRemoved', { username, id });
        return { action: 'removed', username, id };
    }

    async editHotspotUser(usernameOrObj, paramsArg) {
        let username = typeof usernameOrObj === 'object' ? (usernameOrObj.username || usernameOrObj.target) : usernameOrObj;
        let params = typeof usernameOrObj === 'object' ? usernameOrObj : paramsArg;

        this._ensureConnected();
        if (!username) throw new ToolExecutionError('user.edit', 'Username required');

        const users = await this.state.conn
            .menu('/ip/hotspot/user')
            .where('name', username)
            .get();

        if (users.length === 0) {
            throw new ToolExecutionError('user.edit', `User '${username}' not found`);
        }

        const id = this._getId(users[0]);
        const update = {};

        if (params.password) update.password = params.password;
        if (params.profile) update.profile = this._normalizeProfile(params.profile);
        if (params.comment) update.comment = params.comment;

        if (Object.keys(update).length === 0) {
            return { updated: false, reason: 'No fields to update', username };
        }

        await this.state.conn.menu('/ip/hotspot/user').update(id, update);
        return { updated: true, username, fields: Object.keys(update) };
    }



    async disableHotspotUser(usernameOrObj) {
        let username = typeof usernameOrObj === 'object'
            ? (usernameOrObj.username || usernameOrObj.target || usernameOrObj.id || usernameOrObj.name)
            : usernameOrObj;

        this._ensureConnected();
        if (!username) throw new ToolExecutionError('user.disable', 'Username required');

        try {
            // Use low-level _writeRaw for state mutation to bypass high-level abstraction issues
            const users = await this._writeRaw(['/ip/hotspot/user/print', `?name=${username}`]);

            if (!users || users.length === 0) {
                return { action: 'ignored', reason: 'not_found', username };
            }

            const user = users[0];
            const id = this._getId(user);
            if (!id) {
                logger.error(`[MikroTik] disableHotspotUser: No ID found for user '${username}'. Keys: ${Object.keys(user).join(', ')}`);
                return { action: 'failed', reason: 'missing_id', username };
            }

            // Perform the disable
            await this._writeRaw(['/ip/hotspot/user/set', `=.id=${id}`, '=disabled=yes']);

            // Also kick any live session for immediate effect
            try {
                await this.kickUser(username);
            } catch (_) { /* no live session — that's fine */ }

            this.emit('userDisabled', { username, id });
            return { action: 'disabled', username, id };
        } catch (err) {
            logger.error(`[MikroTik] disableHotspotUser failed for '${username}': ${err.message || 'unknown error'}`, err);
            throw err;
        }
    }

    async enableHotspotUser(usernameOrObj) {
        let username = typeof usernameOrObj === 'object'
            ? (usernameOrObj.username || usernameOrObj.target || usernameOrObj.id || usernameOrObj.name)
            : usernameOrObj;

        this._ensureConnected();
        if (!username) throw new ToolExecutionError('user.enable', 'Username required');

        try {
            const users = await this._writeRaw(['/ip/hotspot/user/print', `?name=${username}`]);

            if (!users || users.length === 0) {
                return { action: 'ignored', reason: 'not_found', username };
            }

            const user = users[0];
            const id = this._getId(user);
            if (!id) {
                logger.error(`[MikroTik] enableHotspotUser: No ID found for user '${username}'. Keys: ${Object.keys(user).join(', ')}`);
                return { action: 'failed', reason: 'missing_id', username };
            }

            // Perform the enable
            await this._writeRaw(['/ip/hotspot/user/set', `=.id=${id}`, '=disabled=no']);

            this.emit('userEnabled', { username, id });
            return { action: 'enabled', username, id };
        } catch (err) {
            logger.error(`[MikroTik] enableHotspotUser failed for '${username}': ${err.message || 'unknown error'}`, err);
            throw err;
        }
    }


    async addHotspotProfile(params) {
        let { name, sharedUsers, rateLimit, transparentProxy, macCookieTimeout } = params;
        this._ensureConnected();

        if (!name) throw new ToolExecutionError('profile.add', 'Profile name is required');

        const profile = {
            name,
            'shared-users': sharedUsers || 1,
            'rate-limit': rateLimit || null,
            'transparent-proxy': transparentProxy ? 'yes' : 'no',
            'mac-cookie-timeout': macCookieTimeout || null
        };

        const id = await this.state.conn.menu('/ip/hotspot/user/profile').add(profile);
        return { success: true, id, name };
    }

    async editHotspotProfile(params) {
        let { id, name, ...updates } = params;
        this._ensureConnected();

        if (!id && !name) throw new ToolExecutionError('profile.edit', 'Profile ID or name is required');

        let targetId = id;
        if (!targetId && name) {
            const profiles = await this.state.conn.menu('/ip/hotspot/user/profile').where('name', name).get();
            if (profiles.length === 0) throw new ToolExecutionError('profile.edit', `Profile '${name}' not found`);
            targetId = this._getId(profiles[0]);
        }

        const rosUpdates = {};
        if (updates.sharedUsers) rosUpdates['shared-users'] = updates.sharedUsers;
        if (updates.rateLimit) rosUpdates['rate-limit'] = updates.rateLimit;
        if (updates.transparentProxy !== undefined) rosUpdates['transparent-proxy'] = updates.transparentProxy ? 'yes' : 'no';
        if (updates.macCookieTimeout) rosUpdates['mac-cookie-timeout'] = updates.macCookieTimeout;

        await this.state.conn.menu('/ip/hotspot/user/profile').update(targetId, rosUpdates);
        return { success: true, id: targetId, updatedFields: Object.keys(rosUpdates) };
    }

    async removeHotspotProfile(params) {
        let { id, name } = params;
        this._ensureConnected();

        let targetId = id;
        if (!targetId && name) {
            const profiles = await this.state.conn.menu('/ip/hotspot/user/profile').where('name', name).get();
            if (profiles.length === 0) throw new ToolExecutionError('profile.remove', `Profile '${name}' not found`);
            targetId = this._getId(profiles[0]);
        }

        if (!targetId) throw new ToolExecutionError('profile.remove', 'Profile ID or name is required');

        await this.state.conn.menu('/ip/hotspot/user/profile').remove(targetId);
        return { success: true, removedId: targetId };
    }

    async getAllHotspotUsers() {
        this._ensureConnected();
        return this.state.conn.menu('/ip/hotspot/user').get();
    }

    async getActiveUsers() {
        this._ensureConnected();
        try {
            // Using _writeRaw for high reliability in state reporting
            return await this._writeRaw(['/ip/hotspot/active/print']);
        } catch (e) {
            logger.error(`MikroTik: getActiveUsers failed: ${e.message}`);
            return [];
        }
    }



    _parseBytes(val) {
        if (!val) return 0;
        if (typeof val === 'number') return val;
        const s = String(val).toLowerCase();
        const num = parseFloat(s);
        if (s.endsWith('k')) return num * 1024;
        if (s.endsWith('m')) return num * 1024 * 1024;
        if (s.endsWith('g')) return num * 1024 * 1024 * 1024;
        return num;
    }

    _parseDuration(val) {
        if (!val || val === 'unlimited') return 0;
        const s = String(val).trim();

        // Handle HH:MM:SS format first (common for active sessions)
        if (s.includes(':')) {
            const hms = s.split(':');
            if (hms.length === 3) {
                return parseInt(hms[0]) * 3600 + parseInt(hms[1]) * 60 + parseInt(hms[2]);
            }
            if (hms.length === 2) {
                return parseInt(hms[0]) * 60 + parseInt(hms[1]);
            }
        }

        // Handle unit-based format: 1w2d3h4m5s
        let totalSeconds = 0;
        const parts = s.match(/(\d+w)?(\d+d)?(\d+h)?(\d+m)?(\d+s)?/);
        if (parts && parts[0] !== '') {
            if (parts[1]) totalSeconds += parseInt(parts[1]) * 604800;
            if (parts[2]) totalSeconds += parseInt(parts[2]) * 86400;
            if (parts[3]) totalSeconds += parseInt(parts[3]) * 3600;
            if (parts[4]) totalSeconds += parseInt(parts[4]) * 60;
            if (parts[5]) totalSeconds += parseInt(parts[5]);
            return totalSeconds;
        }

        const num = parseInt(s);
        return isNaN(num) ? 0 : num;
    }

    async getUserReport() {
        this._ensureConnected();
        try {
            const [users, active] = await Promise.all([
                this.state.conn.menu('/ip/hotspot/user').get(),
                this.state.conn.menu('/ip/hotspot/active').get()
            ]);

            const activeSet = new Set(active.map(a => a.user));

            return users.map(u => {
                const username = u.name;
                const isActive = activeSet.has(username);

                return {
                    id: this._getId(u),
                    username,
                    isActive,
                    bytesIn: this._parseBytes(u['bytes-in']),
                    bytesOut: this._parseBytes(u['bytes-out']),
                    bytesTotal: this._parseBytes(u['bytes-in']) + this._parseBytes(u['bytes-out']),
                    uptime: this._parseDuration(u['uptime']),
                    limitBytesTotal: this._parseBytes(u['limit-bytes-total']),
                    limitUptime: this._parseDuration(u['limit-uptime']),
                    profile: u.profile,
                    comment: u.comment,
                    disabled: u.disabled === 'true' || u.disabled === 'yes' || u.disabled === true
                };
            });
        } catch (err) {
            throw new ToolExecutionError('users.report', 'Failed to generate user report: ' + err.message);
        }
    }

    async getUserStatus(usernameOrObj) {
        let target = typeof usernameOrObj === 'object' ? (usernameOrObj.username || usernameOrObj.name || usernameOrObj.target || usernameOrObj.id) : usernameOrObj;
        if (!target) return { success: false, error: 'Username or ID required' };

        this._ensureConnected();

        // Try to determine if target is an ID (* prefix)
        const isId = String(target).startsWith('*');

        const [active, users] = await Promise.all([
            this.state.conn.menu('/ip/hotspot/active').where(isId ? '.id' : 'user', target).get(),
            this.state.conn.menu('/ip/hotspot/user').where(isId ? '.id' : 'name', target).get()
        ]);

        const user = users[0] || {};
        const sess = active[0] || {};
        const username = user.name || sess.user || (isId ? 'unknown' : target);

        return {
            username,
            exists: users.length > 0,
            isActive: active.length > 0,
            disabled: user.disabled === 'true' || user.disabled === 'yes',
            profile: user.profile || 'unknown',
            comment: user.comment || '',
            session: active.length > 0 ? {
                uptime: sess.uptime,
                address: sess.address,
                bytesIn: sess['bytes-in'],
                bytesOut: sess['bytes-out']
            } : null
        };
    }

    async getUserStats(usernameOrObj) {
        let target = typeof usernameOrObj === 'object' ? (usernameOrObj.username || usernameOrObj.name || usernameOrObj.target || usernameOrObj.id) : usernameOrObj;
        if (!target) throw new ToolExecutionError('user.stats', 'Username or ID required');

        this._ensureConnected();
        const isId = String(target).startsWith('*');

        const [users, active] = await Promise.all([
            this.state.conn.menu('/ip/hotspot/user').where(isId ? '.id' : 'name', target).get(),
            this.state.conn.menu('/ip/hotspot/active').where(isId ? '.id' : 'user', target).get()
        ]);

        if (users.length === 0) return { success: false, reason: 'not_found', target };

        const u = users[0];
        const isActive = active.length > 0;
        const s = active[0] || {};

        return {
            success: true,
            username: u.name,
            id: this._getId(u),
            isActive,
            bytesIn: this._parseBytes(u['bytes-in']),
            bytesOut: this._parseBytes(u['bytes-out']),
            bytesTotal: this._parseBytes(u['bytes-in']) + this._parseBytes(u['bytes-out']),
            uptime: this._parseDuration(u['uptime']),
            limitBytesTotal: this._parseBytes(u['limit-bytes-total']),
            limitUptime: this._parseDuration(u['limit-uptime']),
            disabled: u.disabled === 'true' || u.disabled === 'yes',
            session: isActive ? {
                address: s.address,
                uptime: this._parseDuration(s.uptime),
                bytesIn: this._parseBytes(s['bytes-in']),
                bytesOut: this._parseBytes(s['bytes-out']),
                macAddress: s['mac-address']
            } : null
        };
    }

    async kickUser(usernameOrObj) {
        let username = typeof usernameOrObj === 'object' ? (usernameOrObj.username || usernameOrObj.target || usernameOrObj.id) : usernameOrObj;

        this._ensureConnected();
        if (!username || typeof username !== 'string' || username.trim() === '') {
            throw new ToolExecutionError('user.kick', 'A valid username is required to kick');
        }

        const active = await this.state.conn
            .menu('/ip/hotspot/active')
            .where('user', username)
            .get();

        if (active.length === 0) {
            return { kicked: false, username, reason: 'User not active' };
        }

        // Filter to ensure we only kick the intended user (safety check)
        const sessionsToKick = active.filter(s => s.user === username);
        if (sessionsToKick.length === 0) {
            return { kicked: false, username, reason: 'No active sessions match this username' };
        }

        for (const session of sessionsToKick) {
            const id = this._getId(session);
            if (!id) {
                logger.warn(`Skipping kick for user ${username}: session has no ID`);
                continue;
            }
            try {
                // remove() is the standard way to terminate an active session
                await this.state.conn.menu('/ip/hotspot/active').remove(id);
                logger.cyber(`[Enforcement] Kicked session ${id} for user ${username}`);
            } catch (err) {
                logger.error(`[MikroTik] Failed to kick session ${id} for ${username}: ${err.message}`);
                throw err;
            }
        }

        this.emit('userKicked', { username, count: sessionsToKick.length });
        return { kicked: true, username, count: sessionsToKick.length };
    }

    // ── System Tools ──────────────────────────────────────────────────────────

    async getSystemStats(force = false) {
        this._ensureConnected();

        const cacheKey = 'system_stats';
        if (!force) {
            const cached = this.cache.get(cacheKey);
            if (cached) return cached;
        }

        try {
            const stats = await this.state.conn.menu('/system/resource').get();
            const raw = stats[0] || {};

            /**
             * Internal helper to get first available value from potential keys.
             * Handles 0 as a valid value and falls back to default.
             */
            const getVal = (keys, fallback = '0') => {
                for (const key of keys) {
                    if (raw[key] !== undefined && raw[key] !== null) return raw[key];
                }
                return fallback;
            };

            /**
             * Internal helper to ensure a value is a numeric string or number.
             * Strips % signs if present.
             */
            const toNum = (val) => {
                if (typeof val === 'string') {
                    const cleaned = val.replace('%', '').trim();
                    return isNaN(cleaned) ? 0 : Number(cleaned);
                }
                return typeof val === 'number' ? val : 0;
            };

            // Calculate memory metrics safely
            const totalMemory = toNum(getVal(['total-memory', 'totalMemory']));
            const freeMemory = toNum(getVal(['free-memory', 'freeMemory']));
            const usedMemory = totalMemory - freeMemory;
            const memPercent = totalMemory > 0 ? Math.round((usedMemory / totalMemory) * 100) : 0;

            const normalized = {
                // CPU metrics
                'cpu-load': toNum(getVal(['cpu-load', 'cpuLoad', 'cpu-usage'])),
                'cpu-count': toNum(getVal(['cpu-count', 'cpuCount'], '1')),
                'cpu-frequency': toNum(getVal(['cpu-frequency', 'cpuFrequency'])),
                'cpu-model': getVal(['cpu', 'cpu-model', 'cpuModel'], 'unknown'),

                // Memory metrics (in bytes)
                'free-memory': freeMemory,
                'total-memory': totalMemory,
                'used-memory': usedMemory,
                'memory-usage-percent': memPercent.toString(),

                // Storage (in bytes)
                'free-hdd-space': toNum(getVal(['free-hdd-space', 'freeHddSpace'])),
                'total-hdd-space': toNum(getVal(['total-hdd-space', 'totalHddSpace'])),

                // System info
                'uptime': getVal(['uptime'], 'unknown'),
                'version': getVal(['version'], 'unknown'),
                'board-name': getVal(['board-name', 'boardName', 'model'], 'MikroTik'),
                'architecture-name': getVal(['architecture-name', 'architectureName', 'architecture'], 'unknown'),
                'platform': getVal(['platform'], 'MikroTik'),

                // Metadata
                'last-update': new Date().toISOString()
            };

            this.cache.set(cacheKey, normalized);
            return normalized;
        } catch (error) {
            logger.error('Failed to get system stats:', error.message);
            throw new ToolExecutionError('system.stats', `Failed to fetch stats: ${error.message}`, error);
        }
    }
    async getLogs(lines = 10) {
        this._ensureConnected();
        const logs = await this.state.conn.menu('/log').get();
        return logs.slice(-Math.max(1, Math.min(lines, 1000)));
    }

    async getUptime() {
        this._ensureConnected();
        const res = await this.state.conn.menu('/system/resource').get();
        const raw = res[0] || {};
        return {
            uptime: raw['uptime'] || 'unknown',
            date: raw['time'] || null,
            version: raw['version'] || 'unknown'
        };
    }

    async getIdentity() {
        this._ensureConnected();
        const identity = await this.state.conn.menu('/system/identity').get();
        const res = await this.state.conn.menu('/system/resource').get();
        const raw = res[0] || {};
        let serial = 'N/A';
        try {
            const rb = await this.state.conn.menu('/system/routerboard').get();
            serial = rb[0]?.['serial-number'] || 'N/A';
        } catch (_) { }
        return {
            name: identity[0]?.name || 'unknown',
            model: raw['board-name'] || 'unknown',
            version: raw['version'] || 'unknown',
            serial
        };
    }

    async getSystemHealth() {
        this._ensureConnected();
        const stats = await this.getSystemStats();
        const cpu = Number(stats['cpu-load']) || 0;
        const memPct = Number(stats['memory-usage-percent']) || 0;
        let temperature = 'N/A';
        let voltage = 'N/A';
        try {
            const health = await this.state.conn.menu('/system/health').get();
            const h = health[0] || {};
            temperature = h['temperature'] || 'N/A';
            voltage = h['voltage'] || 'N/A';
        } catch (_) { }
        const score = Math.max(0, 100 - (cpu > 80 ? 30 : 0) - (cpu > 95 ? 40 : 0) - (memPct > 90 ? 30 : 0));
        return {
            score,
            status: score >= 70 ? 'HEALTHY' : score >= 40 ? 'DEGRADED' : 'CRITICAL',
            cpu,
            memoryUsedPercent: memPct,
            temperature,
            voltage
        };
    }

    async getSystemResources() {
        this._ensureConnected();
        const stats = await this.getSystemStats();
        return {
            cpu: stats['cpu-load'],
            cpuCount: stats['cpu-count'],
            cpuFrequency: stats['cpu-frequency'],
            architecture: stats['architecture-name'],
            freeMemoryMB: Math.round(Number(stats['free-memory']) / 1024 / 1024),
            totalMemoryMB: Math.round(Number(stats['total-memory']) / 1024 / 1024),
            usedMemoryMB: Math.round(Number(stats['used-memory']) / 1024 / 1024),
            memoryPercent: stats['memory-usage-percent'],
            freeHddMB: Math.round(Number(stats['free-hdd-space']) / 1024 / 1024),
            totalHddMB: Math.round(Number(stats['total-hdd-space']) / 1024 / 1024),
            uptime: stats['uptime'],
            version: stats['version'],
            board: stats['board-name']
        };
    }

    async createBackup() {
        this._ensureConnected();
        const now = new Date();
        const date = now.toISOString().slice(0, 10).replace(/-/g, '');
        const time = now.toTimeString().slice(0, 5).replace(':', '');
        const name = `backup-${date}-${time}`;
        await this._writeRaw(['/system/backup/save', `=name=${name}`]);
        logger.info(`Backup created: ${name}.backup`);
        return { name: `${name}.backup`, config: `${name}.rsc`, date: now.toISOString() };
    }

    async shutdown() {
        this._ensureConnected();
        logger.warn('Initiating system shutdown...');
        try {
            const conn = this.state.conn;
            if (conn && typeof conn.write === 'function') {
                await conn.write(['/system/shutdown']);
            } else if (conn && conn.menu) {
                await conn.menu('/').write(['/system/shutdown']);
            } else {
                throw new Error('Connection lost or invalid');
            }
        } catch (err) {
            logger.warn('Shutdown command sent, connection dropping: ' + err.message);
        }
        this.state.isConnected = false;
        this._clearIntervals();
        this.emit('shutdown', { timestamp: new Date().toISOString() });
        return { status: 'shutdown', message: 'Router is shutting down.' };
    }

    async reboot() {
        this._ensureConnected();
        logger.warn('Initiating system reboot...');
        try {
            const conn = this.state.conn;
            if (conn && typeof conn.write === 'function') {
                await conn.write(['/system/reboot']);
            } else if (conn && conn.menu) {
                await conn.menu('/').write(['/system/reboot']);
            } else {
                throw new Error('Connection lost or invalid');
            }
        } catch (err) {
            logger.warn('Reboot command sent, connection dropping: ' + err.message);
        }
        this.state.isConnected = false;
        this._clearIntervals();
        this.emit('rebooting', { timestamp: new Date().toISOString() });
        return { status: 'rebooting', message: 'Router is rebooting. Connection will be lost.' };
    }

    // ── Network Tools ─────────────────────────────────────────────────────────

    async ping(host, count = 4) {
        this._ensureConnected();
        if (!host || !host.match(/^[\w.-]+$/)) {
            throw new ToolExecutionError('ping', 'Invalid host format');
        }

        const results = await this._writeRaw([
            '/tool/ping',
            `=address=${host}`,
            `=count=${Math.max(1, Math.min(count, 100)).toString()}`
        ]);
        return Array.isArray(results) ? results : (results ? [results] : []);
    }

    async traceroute(host) {
        this._ensureConnected();
        if (!host || !host.match(/^[\w.-]+$/)) {
            throw new ToolExecutionError('traceroute', 'Invalid host format');
        }
        return this._writeRaw(['/tool/traceroute', `=address=${host}`, '=count=1']);
    }

    async speedtest(iface = 'ether1') {
        this._ensureConnected();
        // RouterOS speed-test is async — we trigger it and return status
        try {
            await this._writeRaw(['/tool/speed-test', `=interface=${iface}`, '=duration=10s']);
            return { status: 'started', interface: iface, message: 'Speed test running. Check router logs for results.' };
        } catch (err) {
            return { status: 'error', message: err.message };
        }
    }

    async flushDnsCache() {
        this._ensureConnected();
        await this._writeRaw(['/ip/dns/cache/flush']);
        return { flushed: true, timestamp: new Date().toISOString() };
    }

    async getIpAddresses() {
        this._ensureConnected();
        const addrs = await this.state.conn.menu('/ip/address').get();
        return addrs.map(a => ({
            address: a['address'],
            network: a['network'],
            interface: a['interface'],
            disabled: a['disabled'] === 'true'
        }));
    }

    async getRoutes(limit = 20) {
        this._ensureConnected();
        const routes = await this.state.conn.menu('/ip/route').get();
        return routes.slice(0, limit).map(r => ({
            dst: r['dst-address'],
            gateway: r['gateway'],
            distance: r['distance'],
            active: r['active'],
            dynamic: r['dynamic']
        }));
    }

    async getDnsSettings() {
        this._ensureConnected();
        const dns = await this.state.conn.menu('/ip/dns').get();
        const d = dns[0] || {};
        return {
            servers: d['servers'] || '',
            dynamicServers: d['dynamic-servers'] || '',
            doh: d['use-doh-server'] || 'none',
            cacheSize: d['cache-size'] || 0,
            cacheUsed: d['cache-used'] || 0
        };
    }


    // ── Firewall Tools ────────────────────────────────────────────────────────

    async getFirewallRules(type = 'filter') {
        this._ensureConnected();
        const validTypes = ['filter', 'nat', 'mangle', 'raw'];
        if (!validTypes.includes(type)) {
            throw new ToolExecutionError('firewall.list', `Invalid type '${type}'. Valid: ${validTypes.join(', ')}`);
        }
        return this.state.conn.menu(`/ip/firewall/${type}`).get();
    }

    async getFirewallSummary() {
        this._ensureConnected();
        const [filter, nat, mangle, raw, conns] = await Promise.all([
            this.state.conn.menu('/ip/firewall/filter').get(),
            this.state.conn.menu('/ip/firewall/nat').get(),
            this.state.conn.menu('/ip/firewall/mangle').get(),
            this.state.conn.menu('/ip/firewall/raw').get(),
            this.state.conn.menu('/ip/firewall/connection').get()
        ]);
        return { filter: filter.length, nat: nat.length, mangle: mangle.length, raw: raw.length, connections: conns.length };
    }

    async getActiveConnections(limit = 30) {
        this._ensureConnected();
        const conns = await this.state.conn.menu('/ip/firewall/connection').get();
        return conns.slice(0, limit);
    }

    async getNatRules(limit = 20) {
        this._ensureConnected();
        const rules = await this.state.conn.menu('/ip/firewall/nat').get();
        return rules.slice(0, limit).map(r => ({
            chain: r['chain'],
            action: r['action'],
            dst: r['dst-address'] || '',
            src: r['src-address'] || '',
            toPorts: r['to-ports'] || ''
        }));
    }

    async addToBlockList(target, list = 'blocked', comment = 'Blocked via AgentOS') {
        this._ensureConnected();

        const isIP = /^(\d{1,3}\.){3}\d{1,3}$/.test(target);
        const isMAC = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(target);
        if (!isIP && !isMAC) {
            throw new ToolExecutionError('firewall.block', 'Target must be valid IP or MAC address');
        }

        await this.state.conn.menu('/ip/firewall/address-list').add({
            list, address: target, comment, disabled: 'no'
        });

        this.emit('addressBlocked', { target, list, comment });
        return { action: 'blocked', target, list, comment };
    }

    async removeFromBlockList(target, list = 'blocked') {
        this._ensureConnected();

        const items = await this.state.conn
            .menu('/ip/firewall/address-list')
            .where('list', list)
            .where('address', target)
            .get();

        for (const item of items) {
            await this.state.conn.menu('/ip/firewall/address-list').remove(this._getId(item));
        }

        this.emit('addressUnblocked', { target, list, count: items.length });
        return { action: 'unblocked', target, list, count: items.length };
    }

    // ── Hotspot Profiles ──────────────────────────────────────────────────────



    // ── DHCP & Network Discovery ──────────────────────────────────────────────

    async getDhcpLeases() {
        this._ensureConnected();
        return this.state.conn.menu('/ip/dhcp-server/lease').get();
    }

    async getInterfaces() {
        this._ensureConnected();
        return this.state.conn.menu('/interface').get();
    }

    async getArpTable() {
        this._ensureConnected();
        return this.state.conn.menu('/ip/arp').get();
    }

    async getNeighbors() {
        this._ensureConnected();
        return this.state.conn.menu('/ip/neighbor').get();
    }

    async executeCLI(cmd) {
        this._ensureConnected();
        try {
            let parts = Array.isArray(cmd) ? cmd : String(cmd).split(' ').filter(Boolean);

            // Normalize path for API (e.g. "ip address print" -> "/ip/address/print")
            if (parts.length > 0 && !parts[0].startsWith('/')) {
                let pathParts = [];
                let i = 0;
                while (i < parts.length && !parts[i].includes('=') && !parts[i].startsWith('?') && !parts[i].startsWith('.')) {
                    pathParts.push(parts[i]);
                    i++;
                }
                const path = '/' + pathParts.join('/');
                const args = parts.slice(i).map(arg => {
                    if (arg.startsWith('=') || arg.startsWith('?') || arg.startsWith('.') || arg.startsWith('-')) return arg;
                    return '=' + arg;
                });
                parts = [path, ...args];
            }

            logger.debug(`Executing CLI via API: ${JSON.stringify(parts)}`);
            const result = await this._writeRaw(parts);
            return Array.isArray(result) ? JSON.stringify(result, null, 2) : String(result);
        } catch (e) {
            throw new ToolExecutionError('cli.execute', e.message, e);
        }
    }

    async executeRawAPI(cmd) {
        this._ensureConnected();
        try {
            const parts = Array.isArray(cmd) ? cmd : String(cmd).split(' ').filter(Boolean);
            return await this._writeRaw(parts);
        } catch (e) {
            throw new ToolExecutionError('api.raw', e.message, e);
        }
    }
    // ── Cleanup ───────────────────────────────────────────────────────────────

    async bandwidth(params = {}) {
        const { target, duration = 10 } = params;
        if (!target) throw new Error('Target IP/Host required for bandwidth test');
        this._ensureConnected();
        return await this._writeRaw([
            '/tool/bandwidth-test',
            `=address=${target}`,
            `=duration=${duration}s`,
            '=direction=both'
        ]);
    }

    async flood(params = {}) {
        const { target, count = 100 } = params;
        if (!target) throw new Error('Target IP required for flood-ping');
        this._ensureConnected();
        return await this._writeRaw([
            '/tool/flood-ping',
            `=address=${target}`,
            `=count=${count}`
        ]);
    }

    async sniff(params = {}) {
        const { duration = 5 } = params;
        return await this.executeRawAPI('/tool/sniffer/quick', {
            duration: `${duration}s`
        });
    }



    async cleanupExpiredVouchers(params = {}) {
        const { dryRun = false, force = false } = params;
        this._ensureConnected();
        
        try {
            const { getDatabase } = require('./database');
            const db = await getDatabase();
            if (!db) throw new Error('Database not available for cleanup');

            const now = new Date().toISOString();
            const vouchers = await db.getVouchers();
            const expired = vouchers.filter(v => v.expiresAt && v.expiresAt < now);

            const results = {
                total: vouchers.length,
                expired: expired.length,
                removed: [],
                failed: []
            };

            if (dryRun) return { ...results, status: 'dry-run-complete' };

            for (const voucher of expired) {
                try {
                    await this.removeHotspotUser(voucher.username || voucher.code);
                    await db.deleteVoucher(voucher.username || voucher.code);
                    results.removed.push(voucher.username || voucher.code);
                } catch (err) {
                    results.failed.push({ code: voucher.username || voucher.code, error: err.message });
                }
            }

            return results;
        } catch (err) {
            logger.error(`Voucher cleanup failed: ${err.message}`);
            throw err;
        }
    }

    async getFullSystemStats() {
        this._ensureConnected();
        const [resources, health, identity, neighbors] = await Promise.all([
            this.getSystemResources(),
            this.getSystemHealth(),
            this.getIdentity(),
            this.getNeighbors()
        ]);

        return {
            identity,
            health,
            resources,
            neighbors,
            timestamp: new Date().toISOString()
        };
    }

    availableTools() {
        return Array.from(this.tools.keys());
    }
}
// ── Connection Pool ───────────────────────────────────────────────────────────

class MikroTikPool {
    constructor() {
        this.connections = new Map();
        this.defaultRouter = null;
    }

    async addRouter(id, config) {
        const manager = new MikroTikManager(config);
        await manager.connect();
        if (!this.defaultRouter) this.defaultRouter = manager;
        this.connections.set(id, manager);
        return manager;
    }

    getRouter(id = 'default') {
        return this.connections.get(id) || this.defaultRouter;
    }

    async executeOnAll(tool, params) {
        return Promise.allSettled(
            Array.from(this.connections.values()).map(conn => conn.executeTool(tool, params))
        );
    }

    destroyAll() {
        for (const manager of this.connections.values()) manager.destroy();
        this.connections.clear();
        this.defaultRouter = null;
    }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let managerInstance = null;

function getManager(options = {}) {
    if (!managerInstance) {
        managerInstance = new MikroTikManager(options);

        const cleanup = () => {
            if (managerInstance) { managerInstance.destroy(); managerInstance = null; }
        };
        process.on('SIGINT', cleanup);
        process.on('SIGTERM', cleanup);
        process.on('exit', cleanup);
    }
    return managerInstance;
}

function resetManager() {
    if (managerInstance) { managerInstance.destroy(); managerInstance = null; }
}

function createManager(options = {}) {
    return new MikroTikManager(options);
}

// ── Connection Test ───────────────────────────────────────────────────────────

async function testConnection(config = null) {
    const testConfig = config || getConfig().mikrotik;

    const client = new RouterOSClient({
        host: testConfig.host || testConfig.ip,
        user: testConfig.user,
        password: testConfig.pass || testConfig.password,
        port: testConfig.port || 8728,
        timeout: 10_000
    });

    let conn = null;
    let timer = null;
    try {
        const timeout = 10000;
        const safetyTimeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Operation timed out after ${timeout}ms`)), timeout);
        });

        conn = await Promise.race([client.connect(), safetyTimeout]);
        await Promise.race([conn.menu('/system/resource').get(), safetyTimeout]);

        return { success: true, message: 'Connection successful' };
    } catch (error) {
        return { success: false, message: error.message, code: error.code || 'UNKNOWN_ERROR' };
    } finally {
        if (timer) clearTimeout(timer);
        if (conn) {
            try { if (conn.close) conn.close(); } catch (_) { }
        }
        if (client) {
            try { if (client.close) client.close(); } catch (_) { }
        }
    }
}
// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
    // Classes
    MikroTikManager,
    MikroTikPool,
    CircuitBreaker,
    MikroTikError,
    ConnectionError,
    ToolExecutionError,

    // Factories
    getManager,
    resetManager,
    createManager,

    // Utilities
    testConnection,

    // Legacy alias
    getMikroTikClient: getManager,
    testMikroTikConnection: testConnection
};
