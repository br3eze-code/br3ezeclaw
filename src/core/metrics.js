'use strict';

const promClient = require('prom-client');

const registry = new promClient.Registry();

// Custom metrics
const mikrotikCommands = new promClient.Counter({
  name:       'mikrotik_commands_total',
  help:       'Total MikroTik commands executed',
  labelNames: ['tool', 'status'],
  registers:  [registry]
});

const activeConnections = new promClient.Gauge({
  name:      'websocket_connections_active',
  help:      'Active WebSocket connections',
  registers: [registry]
});

// Express middleware — records per-request duration
function metricsMiddleware(req, res, next) {
  res.locals.startTime = Date.now();
  res.on('finish', () => {
    // Duration available at: Date.now() - res.locals.startTime
  });
  next();
}

// Express route handler — exposes Prometheus scrape endpoint
// Legacy compatible Metrics class
class Metrics {
  constructor() {
    this.startedAt = Date.now();
    this.requests = 0;
    this.errors = 0;
    this.toolInvocations = 0;
    this.vouchersCreated = 0;
    this.vouchersRedeemed = 0;
    this.wsMessages = 0;
    this.alertsFired = 0;
  }

  tick(isError = false) {
    this.requests++;
    if (isError) this.errors++;
    activeConnections.set(this.requests); 
  }

  snapshot() {
    const { costTracker } = require('./cost-tracker');
    return {
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      requests: this.requests,
      errors: this.errors,
      toolInvocations: this.toolInvocations,
      vouchersCreated: this.vouchersCreated,
      vouchersRedeemed: this.vouchersRedeemed,
      wsMessages: this.wsMessages,
      alertsFired: this.alertsFired,
      cost: costTracker.snapshot(),
    };
  }

  getUptime() {
    const diff = Date.now() - this.startedAt;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `${h}h ${m}m`;
  }
}

const metrics = new Metrics();

module.exports = { Metrics, metrics, registry, mikrotikCommands, activeConnections, metricsMiddleware };


