// src/plugins/adapters/mikrotik-adapter.js
const BaseAdapter = require('../base-adapter');
const { RouterOSClient } = require('routeros-client');
const { Resource } = require('../../core/resource-model');

class MikroTikAdapter extends BaseAdapter {
  constructor(config) {
    super({ ...config, name: 'mikrotik', type: 'network' });
    this.client = null;
    this.actionMap = {
      'user.add': this.addHotspotUser.bind(this),
      'user.kick': this.kickUser.bind(this),
      'users.active': this.getActiveUsers.bind(this),
      'ping': this.ping.bind(this),
      'system.stats': this.getSystemStats.bind(this),
      'system.reboot': this.reboot.bind(this),
      'firewall.block': this.blockAddress.bind(this),
      'voucher.create': this.createVoucher.bind(this)
    };
  }

  async connect() {
    this.client = new RouterOSClient({
      host: this.config.host,
      user: this.config.user,
      password: this.config.password,
      port: this.config.port || 8728,
      timeout: 10000
    });

    this.connection = await this.client.connect();
    this.connected = true;
    
    // Create resource representation
    const router = new Resource({
      type: 'router',
      provider: 'mikrotik',
      name: this.config.name || 'MikroTik Router',
      capabilities: Object.keys(this.actionMap),
      properties: {
        host: this.config.host,
        port: this.config.port,
        version: await this.getVersion()
      }
    });

    this.resources.set(router.id, router);
    return router;
  }

  async disconnect() {
    if (this.connection) {
      await this.connection.close();
    }
    this.connected = false;
  }

  async discover() {
    // Discover connected devices/leases
    const leases = await this.connection.menu('/ip/dhcp-server/lease').get();
    const devices = leases.map(lease => new Resource({
      type: 'network_client',
      provider: 'mikrotik',
      name: lease.hostName || lease.macAddress,
      parentId: Array.from(this.resources.keys())[0],
      properties: lease
    }));

    devices.forEach(d => this.resources.set(d.id, d));
    return Array.from(this.resources.values());
  }

  async execute(resourceId, action, params) {
    if (!this.actionMap[action]) {
      throw new Error(`Action ${action} not supported by MikroTik adapter`);
    }

    // Add audit logging
    logger.audit('adapter_execute', {
      adapter: 'mikrotik',
      resource: resourceId,
      action,
      params: this.sanitizeParams(params)
    });

    return await this.actionMap[action](params);
  }

  async createVoucher(params) {
    // Implementation from previous code
    const code = this.generateCode();
    const profile = params.plan || 'default';
    
    await this.connection.menu('/ip/hotspot/user').add({
      name: code,
      password: code,
      profile: profile,
      comment: `Voucher: ${params.notes || 'AgentOS'}`
    });

    return {
      code,
      profile,
      expiresAt: this.calculateExpiry(profile),
      qrCode: await this.generateQR(code)
    };
  }

  // ... other methods from original mikrotik.js adapted to adapter pattern

  listActions() {
    return Object.keys(this.actionMap);
  }

  sanitizeParams(params) {
    const sanitized = { ...params };
    delete sanitized.password;
    delete sanitized.token;
    return sanitized;
  }
}

module.exports = MikroTikAdapter;
