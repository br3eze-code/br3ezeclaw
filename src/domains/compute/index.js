// src/domains/compute/index.js
const BaseDomain = require('../BaseDomain');

class ComputeDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'compute';
    
    this.registerTool({
      name: 'stats',
      description: 'Get CPU and memory utilization statistics',
      execute: async () => {
        const memory = process.memoryUsage();
        const load = await this._getLoad();
        return {
          cpu: `${load}%`,
          memory: {
            heapUsed: `${Math.floor(memory.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.floor(memory.heapTotal / 1024 / 1024)}MB`,
            rss: `${Math.floor(memory.rss / 1024 / 1024)}MB`
          }
        };
      }
    });
    
    this.registerTool({
      name: 'processes',
      description: 'List active internal tasks and agents',
      execute: async () => {
        return [
          { id: 'fleet-master', status: 'running', uptime: process.uptime() },
          { id: 'billing-reaper', status: 'active', interval: '10m' }
        ];
      }
    });
  }

  async _getLoad() {
    // Simple mock load for now, would use 'os' module in production
    return (Math.random() * 20).toFixed(1);
  }
}

module.exports = ComputeDomain;
