/**
 * MikroTik Manager — Clean, Reliable, Production-Ready
 * @module core/mikrotik
 * @version 2026.03.27
 */

const { RouterOSClient } = require('routeros-client');
const { logger } = require('./logger');
const { getConfig } = require('./config');
const NodeCache = require('node-cache');
const Joi = require('joi');
const EventEmitter = require('events');

const toolSchemas = {
  'ping': Joi.object({
    host: Joi.string().hostname().required(),
    count: Joi.number().integer().min(1).max(100).default(4)
  }),
  'user.add': Joi.object({
    username: Joi.string().alphanum().min(3).max(50).required(),
    password: Joi.string().min(6).required(),
    profile: Joi.string().valid('default', '1hour', '1day', '1week').default('default')
  })
// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_TIMEOUT = 10000;
const RECONNECT_INTERVAL = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;
const HEARTBEAT_INTERVAL = 30000;

// ============================================================================
// ERROR CLASSES
// ============================================================================
class CircuitBreaker {
  constructor(threshold = 5, timeout = 60000) {
    this.failures = 0;
    this.threshold = threshold;
    this.timeout = timeout;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.nextAttempt = Date.now();
  }
  
  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }
  
  onFailure() {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
    }
  }
}

// Use in MikroTikManager:
this.circuitBreaker = new CircuitBreaker();
async executeTool(toolName, ...args) {
  return this.circuitBreaker.execute(() => {
    const tool = this.tools.get(toolName);
    return tool(...args);
  });
}

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

class MikroTikPool {
  constructor() {
    this.connections = new Map(); 
    this.defaultRouter = null;
  }
  
  async addRouter(id, config) {
    const manager = new MikroTikManager(config);
    await manager.connect();
    this.connections.set(id, manager);
    return manager;
  }
  
  getRouter(id = 'default') {
    return this.connections.get(id) || this.defaultRouter;
  }
  
  async executeOnAll(tool, params) {
    const results = await Promise.allSettled(
      Array.from(this.connections.values()).map(conn => 
        conn.executeTool(tool, params)
      )
    );
    return results;
  }
}
module.exports = { MikroTikPool };
// ============================================================================
// MIKROTIK MANAGER CLASS
// ============================================================================

class MikroTikManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.cache = new NodeCache({ stdTTL: 30, checkperiod: 60 });
    this.config = {
      host: options.host || getConfig().mikrotik?.host || '192.168.88.1',
      user: options.user || getConfig().mikrotik?.user || 'admin',
      password: options.password || getConfig().mikrotik?.pass || '',
      port: options.port || getConfig().mikrotik?.port || 8728,
      timeout: options.timeout || DEFAULT_TIMEOUT
    };

    this.state = {
      conn: null,
      isConnected: false,
      reconnectAttempts: 0,
      lastError: null,
      lastConnectedAt: null
    };

    this.intervals = {
      heartbeat: null,
      reconnect: null
    };

    this.tools = new Map();
    this._registerTools();
    
    // Auto-bind methods for event handlers
    this._handleDisconnect = this._handleDisconnect.bind(this);
    this._heartbeat = this._heartbeat.bind(this);
  }

  // --------------------------------------------------------------------------
  // TOOL REGISTRY
  // --------------------------------------------------------------------------

  _registerTools() {
    const tools = [
      ['user.add', this.addHotspotUser],
      ['user.remove', this.removeHotspotUser],
      ['user.kick', this.kickUser],
      ['user.status', this.getUserStatus],
      ['users.active', this.getActiveUsers],
      ['users.all', this.getAllHotspotUsers],
      ['system.stats', this.getSystemStats],
      ['system.logs', this.getLogs],
      ['system.reboot', this.reboot],
      ['ping', this.ping],
      ['traceroute', this.traceroute],
      ['firewall.list', this.getFirewallRules],
      ['firewall.block', this.addToBlockList],
      ['firewall.unblock', this.removeFromBlockList],
      ['dhcp.leases', this.getDhcpLeases],
      ['interface.list', this.getInterfaces],
      ['arp.table', this.getArpTable]
    ];

    for (const [name, fn] of tools) {
      this.tools.set(name, fn.bind(this));
    }
  }

  // --------------------------------------------------------------------------
  // CONNECTION MANAGEMENT
  // --------------------------------------------------------------------------

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

      this.state.conn = await client.connect();
      this.state.isConnected = true;
      this.state.reconnectAttempts = 0;
      this.state.lastConnectedAt = new Date().toISOString();
      this.state.lastError = null;

      this._startHeartbeat();
      this.emit('connected', { host: this.config.host, timestamp: this.state.lastConnectedAt });
      
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
    logger.info('Disconnecting from MikroTik...');
    
    this._clearIntervals();
    
    if (this.state.conn) {
      try {
        this.state.conn.close();
      } catch (error) {
        logger.warn('Error during disconnect:', error.message);
      }
    }
    
    this.state.conn = null;
    this.state.isConnected = false;
    
    this.emit('disconnected', { timestamp: new Date().toISOString() });
    logger.info('🔌 MikroTik disconnected');
  }

  async reconnect() {
    logger.info('Forcing reconnection...');
    this.disconnect();
    await this.connect();
  }

  // --------------------------------------------------------------------------
  // CONNECTION MONITORING
  // --------------------------------------------------------------------------

  _startHeartbeat() {
    this._clearIntervals();
    
    this.intervals.heartbeat = setInterval(this._heartbeat, HEARTBEAT_INTERVAL);
    
    // Unref to prevent blocking process exit
    if (this.intervals.heartbeat.unref) {
      this.intervals.heartbeat.unref();
    }
  }

  async _heartbeat() {
    if (!this.state.isConnected || !this.state.conn) return;

    try {
      await this.state.conn.menu('/system/resource').get();
      // Heartbeat successful
    } catch (error) {
      logger.warn('Heartbeat failed, connection lost');
      this._handleDisconnect(error);
    }
  }

  _handleDisconnect(error) {
    this.state.isConnected = false;
    this.state.lastError = error;
    
    this.emit('connectionLost', { error: error.message, timestamp: new Date().toISOString() });
    
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this.state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error(`Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached`);
      this.emit('maxReconnectReached', { attempts: this.state.reconnectAttempts });
      return;
    }

    this.state.reconnectAttempts++;
    const delay = Math.min(RECONNECT_INTERVAL * this.state.reconnectAttempts, 60000);
    
    logger.info(`Scheduling reconnect attempt ${this.state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);
    
    this.intervals.reconnect = setTimeout(() => {
      this.connect().catch(err => {
        logger.error('Scheduled reconnect failed:', err.message);
      });
    }, delay);

    if (this.intervals.reconnect.unref) {
      this.intervals.reconnect.unref();
    }
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

  // --------------------------------------------------------------------------
  // CONNECTION VALIDATION
  // --------------------------------------------------------------------------

  _ensureConnected() {
    if (!this.state.isConnected || !this.state.conn) {
      throw new ConnectionError('MikroTik not connected. Call connect() first.');
    }
  }

  // --------------------------------------------------------------------------
  // TOOL EXECUTION
  // --------------------------------------------------------------------------

  async executeTool(toolName, ...args) {
    const schema = toolSchemas[toolName];
      if (schema) {
    const { error, value } = schema.validate(params);
    if (error) throw new ToolExecutionError(toolName, `Invalid params: ${error.message}`);
    params = value; 
  }
    this._ensureConnected();
    
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new ToolExecutionError(toolName, `Tool '${toolName}' not found. Available: ${this.getAvailableTools().join(', ')}`);
    }

    try {
      const startTime = Date.now();
      const result = await tool(...args);
      const duration = Date.now() - startTime;
      
      this.emit('toolExecuted', { tool: toolName, duration, args });
      
      return result;
    } catch (error) {
      const toolError = new ToolExecutionError(
        toolName,
        error.message || 'Unknown error',
        error
      );
      
      this.emit('toolError', { tool: toolName, error: toolError });
      throw toolError;
    }
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

  // --------------------------------------------------------------------------
  // HOTSPOT USER MANAGEMENT
  // --------------------------------------------------------------------------

  async addHotspotUser(username, password, profile = 'default') {
    this._ensureConnected();

    if (!username || !password) {
      throw new ToolExecutionError('user.add', 'Username and password are required');
    }

    // Check if user exists
    const existing = await this.state.conn
      .menu('/ip/hotspot/user')
      .where('name', username)
      .get();

    if (existing.length > 0) {
      // Update existing user
      await this.state.conn
        .menu('/ip/hotspot/user')
        .update(existing[0]['.id'], {
          password: password,
          profile: profile,
          disabled: 'no'
        });
      
      this.emit('userUpdated', { username, profile });
      return { action: 'updated', username, profile, id: existing[0]['.id'] };
    }

    // Create new user
    const result = await this.state.conn
      .menu('/ip/hotspot/user')
      .add({
        name: username,
        password: password,
        profile: profile
      });

    this.emit('userCreated', { username, profile });
    return { action: 'created', username, profile, id: result };
  }

  async removeHotspotUser(username) {
    this._ensureConnected();

    const users = await this.state.conn
      .menu('/ip/hotspot/user')
      .where('name', username)
      .get();

    if (users.length === 0) {
      throw new ToolExecutionError('user.remove', `User '${username}' not found`);
    }

    await this.state.conn
      .menu('/ip/hotspot/user')
      .remove(users[0]['.id']);

    this.emit('userRemoved', { username, id: users[0]['.id'] });
    return { action: 'removed', username, id: users[0]['.id'] };
  }

  async getAllHotspotUsers() {
    this._ensureConnected();
    return await this.state.conn.menu('/ip/hotspot/user').get();
  }

  async getActiveUsers() {
    this._ensureConnected();
    return await this.state.conn.menu('/ip/hotspot/active').get();
  }

  async getUserStatus(username) {
    this._ensureConnected();
    const active = await this.state.conn
      .menu('/ip/hotspot/active')
      .where('user', username)
      .get();
    
    return active.length > 0 ? {
      isActive: true,
      ...active[0]
    } : {
      isActive: false,
      username
    };
  }

  async kickUser(username) {
    this._ensureConnected();

    const active = await this.state.conn
      .menu('/ip/hotspot/active')
      .where('user', username)
      .get();

    if (active.length === 0) {
      return { kicked: false, username, reason: 'User not active' };
    }

    await this.state.conn
      .menu('/ip/hotspot/active')
      .remove(active[0]['.id']);

    this.emit('userKicked', { username, address: active[0].address });
    return { kicked: true, username, address: active[0].address, id: active[0]['.id'] };
  }

  // --------------------------------------------------------------------------
  // SYSTEM TOOLS
  // --------------------------------------------------------------------------

  async getSystemStats() {
    this._ensureConnected();
       const cacheKey = 'system_stats';
    if (!force) {
      const cached = this.cache.get(cacheKey);
      if (cached) return cached;
    }
    const resources = await this.state.conn.menu('/system/resource').get();
    return resources[0] || null;
  }
    const stats = await this.state.conn.menu('/system/resource').get();
    this.cache.set(cacheKey, stats[0]);
    return stats[0];
  }
  
  invalidateCache(pattern) {
    const keys = this.cache.keys();
    keys.filter(k => k.includes(pattern)).forEach(k => this.cache.del(k));
  }
}
  async getLogs(lines = 10) {
    this._ensureConnected();
    const logs = await this.state.conn.menu('/log').get();
    return logs.slice(-Math.max(1, Math.min(lines, 1000)));
  }

  async reboot() {
    this._ensureConnected();
    
    logger.warn('Initiating system reboot...');
    
    await this.state.conn.menu('/system').call('reboot');
    
    // Connection will be lost, clean up state
    this.state.isConnected = false;
    this._clearIntervals();
    
    this.emit('rebooting', { timestamp: new Date().toISOString() });
    
    return { status: 'rebooting', message: 'Router is rebooting. Connection will be lost.' };
  }

  // --------------------------------------------------------------------------
  // NETWORK TOOLS
  // --------------------------------------------------------------------------

  async ping(host, count = 4) {
    this._ensureConnected();

    if (!host || !host.match(/^[\w.-]+$/)) {
      throw new ToolExecutionError('ping', 'Invalid host format');
    }

  const results = await this.state.conn.write([
    '/tool/ping',
    `=address=${host}`,
    `=count=${Math.max(1, Math.min(count, 100)).toString()}`
]);
return Array.isArray(results) ? results : (results ? [results] : []);
    
  async traceroute(host) {
    this._ensureConnected();

    if (!host || !host.match(/^[\w.-]+$/)) {
      throw new ToolExecutionError('traceroute', 'Invalid host format');
    }

    return await this.state.conn
      .menu('/tool/traceroute')
      .call({
        address: host,
        count: '1'
      });
  }

  // --------------------------------------------------------------------------
  // FIREWALL TOOLS
  // --------------------------------------------------------------------------

  async getFirewallRules(type = 'filter') {
    this._ensureConnected();

    const validTypes = ['filter', 'nat', 'mangle', 'raw'];
    if (!validTypes.includes(type)) {
      throw new ToolExecutionError('firewall.list', `Invalid type '${type}'. Valid: ${validTypes.join(', ')}`);
    }

    return await this.state.conn.menu(`/ip/firewall/${type}`).get();
  }

  async addToBlockList(target, list = 'blocked', comment = 'Blocked via AgentOS') {
    this._ensureConnected();

    // Validate IP or MAC format
    const isIP = target.match(/^(\d{1,3}\.){3}\d{1,3}$/);
    const isMAC = target.match(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/);
    
    if (!isIP && !isMAC) {
      throw new ToolExecutionError('firewall.block', 'Target must be valid IP or MAC address');
    }

    await this.state.conn
      .menu('/ip/firewall/address-list')
      .add({
        list: list,
        address: target,
        comment: comment,
        disabled: 'no'
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
      await this.state.conn
        .menu('/ip/firewall/address-list')
        .remove(item['.id']);
    }

    this.emit('addressUnblocked', { target, list, count: items.length });
    return { action: 'unblocked', target, list, count: items.length };
  }

  // --------------------------------------------------------------------------
  // DHCP & NETWORK DISCOVERY
  // --------------------------------------------------------------------------

  async getDhcpLeases() {
    this._ensureConnected();
    return await this.state.conn.menu('/ip/dhcp-server/lease').get();
  }

  async getInterfaces() {
    this._ensureConnected();
    return await this.state.conn.menu('/interface').get();
  }

  async getArpTable() {
    this._ensureConnected();
    return await this.state.conn.menu('/ip/arp').get();
  }

  // --------------------------------------------------------------------------
  // CLEANUP
  // --------------------------------------------------------------------------

  destroy() {
    this._clearIntervals();
    this.removeAllListeners();
    this.disconnect();
  }
}

// ============================================================================
// SINGLETON MANAGEMENT
// ============================================================================

let managerInstance = null;

function getManager(options = {}) {
  if (!managerInstance) {
    managerInstance = new MikroTikManager(options);
    
    // Handle process exit gracefully
    const cleanup = () => {
      if (managerInstance) {
        managerInstance.destroy();
        managerInstance = null;
      }
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);
  }
  return managerInstance;
}

function resetManager() {
  if (managerInstance) {
    managerInstance.destroy();
    managerInstance = null;
  }
}

function createManager(options = {}) {
  // Create new instance without affecting singleton
  return new MikroTikManager(options);
}

// ============================================================================
// CONNECTION TESTING
// ============================================================================

async function testConnection(config = null) {
  const testConfig = config || getConfig().mikrotik;
  
  const client = new RouterOSClient({
    host: testConfig.host || testConfig.ip,
    user: testConfig.user,
    password: testConfig.pass || testConfig.password,
    port: testConfig.port || 8728,
    timeout: 5000
  });

  let conn = null;
  try {
    conn = await client.connect();
    await conn.menu('/system/resource').get();
    return { success: true, message: 'Connection successful' };
  } catch (error) {
    return { 
      success: false, 
      message: error.message,
      code: error.code || 'UNKNOWN_ERROR'
    };
  } finally {
    if (conn) {
      try {
        conn.close();
      } catch (e) {
        // Ignore close errors
      }
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Classes
  MikroTikManager,
  MikroTikError,
  ConnectionError,
  ToolExecutionError,
  
  // Factory functions
  getManager,
  resetManager,
  createManager,
  
  // Utilities
  testConnection,
  
  // Legacy compatibility (deprecated)
  getMikroTikClient: getManager,
  testMikroTikConnection: testConnection
};
