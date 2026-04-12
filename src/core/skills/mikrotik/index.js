
// skills/mikrotik/index.js
const RouterOSClient = require('routeros-client').RouterOSClient;

class MikroTikSkill {
  constructor() {
    this.connections = new Map();
    this.poolConfig = {
      maxConnections: 5,
      idleTimeout: 600000
    };
  }

  async initialize(config) {
    this.config = config;
    // Start connection pool cleanup
    this.cleanupInterval = setInterval(() => this.cleanupPools(), 300000);
  }

  async execute(params, context) {
    const { action, router, params: actionParams } = params;
    
    // Get router configuration
    const routerConfig = await this.getRouterConfig(router, context);
    if (!routerConfig) {
      throw new Error(`Router not found: ${router}`);
    }

    // Route to specific action
    const [category, method] = action.split('.');
    
    switch (category) {
      case 'users':
        return this.handleUsers(method, routerConfig, actionParams);
      case 'system':
        return this.handleSystem(method, routerConfig, actionParams);
      case 'firewall':
        return this.handleFirewall(method, routerConfig, actionParams);
      case 'ping':
        return this.handlePing(routerConfig, actionParams);
      case 'voucher':
        return this.handleVoucher(method, routerConfig, actionParams, context);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  async handleUsers(action, routerConfig, params) {
    const client = await this.getConnection(routerConfig);
    
    try {
      switch (action) {
        case 'list':
          const users = await client.menu('/ip hotspot active print');
          return {
            count: users.length,
            users: users.map(u => ({
              name: u.name,
              address: u.address,
              uptime: u.uptime,
              bytesIn: u['bytes-in'],
              bytesOut: u['bytes-out']
            }))
          };
          
        case 'kick':
          if (!params.username) throw new Error('Username required');
          await client.menu('/ip hotspot active').remove({ name: params.username });
          return { success: true, message: `User ${params.username} kicked` };
          
        case 'add':
          if (!params.username || !params.password) {
            throw new Error('Username and password required');
          }
          await client.menu('/ip hotspot user').add({
            name: params.username,
            password: params.password,
            profile: params.profile || 'default'
          });
          return { success: true, message: `User ${params.username} created` };
          
        default:
          throw new Error(`Unknown user action: ${action}`);
      }
    } finally {
      this.releaseConnection(routerConfig, client);
    }
  }

  async handleSystem(action, routerConfig, params) {
    const client = await this.getConnection(routerConfig);
    
    try {
      switch (action) {
        case 'stats':
          const resources = await client.menu('/system resource print');
          return {
            cpu: resources['cpu-load'],
            memory: {
              total: resources['total-memory'],
              free: resources['free-memory']
            },
            uptime: resources.uptime,
            version: resources.version
          };
          
        case 'reboot':
          if (!params.confirm) {
            return { 
              requiresConfirmation: true,
              message: 'Type YES to confirm reboot'
            };
          }
          await client.menu('/system').reboot();
          return { success: true, message: 'Router rebooting...' };
          
        default:
          throw new Error(`Unknown system action: ${action}`);
      }
    } finally {
      this.releaseConnection(routerConfig, client);
    }
  }

  async getConnection(routerConfig) {
    const key = `${routerConfig.host}:${routerConfig.port}`;
    
    // Connection pooling logic
    let pool = this.connections.get(key);
    if (!pool) {
      pool = { available: [], inUse: [] };
      this.connections.set(key, pool);
    }
    
    // Reuse available connection
    if (pool.available.length > 0) {
      const conn = pool.available.pop();
      pool.inUse.push(conn);
      return conn;
    }
    
    // Create new connection
    const client = new RouterOSClient({
      host: routerConfig.host,
      port: routerConfig.port,
      user: routerConfig.user,
      password: routerConfig.password,
      timeout: 30000
    });
    
    await client.connect();
    pool.inUse.push(client);
    
    return client;
  }

  releaseConnection(routerConfig, client) {
    const key = `${routerConfig.host}:${routerConfig.port}`;
    const pool = this.connections.get(key);
    
    if (pool) {
      const idx = pool.inUse.indexOf(client);
      if (idx > -1) {
        pool.inUse.splice(idx, 1);
        pool.available.push(client);
      }
    }
  }

  cleanupPools() {
    for (const [key, pool] of this.connections) {
      // Close idle connections
      while (pool.available.length > this.poolConfig.maxConnections) {
        const conn = pool.available.pop();
        conn.close();
      }
    }
  }

  async getRouterConfig(routerId, context) {
    // Get from agent memory/config
    const routers = await context.memory.get('config:routers') || {};
    return routers[routerId];
  }

  validate(params) {
    return params.action && params.router;
  }

  async destroy() {
    clearInterval(this.cleanupInterval);
    for (const [key, pool] of this.connections) {
      for (const conn of [...pool.available, ...pool.inUse]) {
        conn.close();
      }
    }
    this.connections.clear();
  }
}

module.exports = new MikroTikSkill();
