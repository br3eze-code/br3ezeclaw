// src/core/HealthMonitor.js
const EventEmitter = require('events');
const os = require('os');

class HealthMonitor extends EventEmitter {
  constructor(agent) {
    super();
    this.agent = agent;
    this.metrics = {
      startTime: Date.now(),
      interactions: 0,
      errors: 0,
      skillExecutions: new Map(),
      channelMessages: new Map()
    };
    this.checks = [];
    this.interval = null;
  }

  start(intervalMs = 30000) {
    this.interval = setInterval(() => this.runChecks(), intervalMs);
    
    // Setup event listeners
    this.agent.on('interaction', () => this.metrics.interactions++);
    this.agent.skills.on('skillLoaded', (name) => {
      this.metrics.skillExecutions.set(name, { count: 0, errors: 0 });
    });
  }

  registerCheck(name, checkFn) {
    this.checks.push({ name, fn: checkFn });
  }

  async runChecks() {
    const results = [];
    
    for (const check of this.checks) {
      try {
        const start = Date.now();
        const result = await check.fn();
        results.push({
          name: check.name,
          status: result ? 'healthy' : 'unhealthy',
          responseTime: Date.now() - start
        });
      } catch (error) {
        results.push({
          name: check.name,
          status: 'error',
          error: error.message
        });
      }
    }

    const status = this.compileStatus(results);
    this.emit('healthCheck', status);
    
    return status;
  }

  compileStatus(checkResults) {
    const system = {
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.metrics.startTime,
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      loadAvg: os.loadavg(),
      freeMem: os.freemem(),
      totalMem: os.totalmem()
    };

    const unhealthy = checkResults.filter(r => r.status !== 'healthy');
    
    return {
      status: unhealthy.length === 0 ? 'healthy' : 'degraded',
      system,
      checks: checkResults,
      metrics: {
        totalInteractions: this.metrics.interactions,
        totalErrors: this.metrics.errors,
        errorRate: this.metrics.errors / Math.max(this.metrics.interactions, 1),
        skillStats: Object.fromEntries(this.metrics.skillExecutions),
        channelStats: Object.fromEntries(this.metrics.channelMessages)
      }
    };
  }

  getStatus() {
    return this.compileStatus([]);
  }

  async stop() {
    clearInterval(this.interval);
  }
}

module.exports = HealthMonitor;
