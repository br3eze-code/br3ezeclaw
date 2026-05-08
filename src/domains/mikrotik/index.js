const BaseDomain = require('../BaseDomain');
const { MikroTikManager } = require('../../core/mikrotik');

class MikroTikDomain extends BaseDomain {
  constructor(config) {
    super();
    this.name = 'mikrotik';
    this.client = new MikroTikManager(config);

    this.registerTool({
      name: 'getStats',
      description: 'Get router system statistics',
      execute: async () => this.client.getSystemStats()
    });

    this.registerTool({
      name: 'getArp',
      description: 'Get ARP table',
      execute: async () => this.client.getArpTable()
    });

    this.registerTool({
      name: 'reboot',
      description: 'Reboot the router',
      execute: async () => this.client.reboot()
    });
  }
}

module.exports = MikroTikDomain;
