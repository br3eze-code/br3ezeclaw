import promClient from 'prom-client';

const registry = new promClient.Registry();

// Custom metrics
const mikrotikCommands = new promClient.Counter({
  name: 'mikrotik_commands_total',
  help: 'Total MikroTik commands executed',
  labelNames: ['tool', 'status'],
  registers: [registry]
});

const activeConnections = new promClient.Gauge({
  name: 'websocket_connections_active',
  help: 'Active WebSocket connections',
  registers: [registry]
});

// Export middleware for Express
export function metricsMiddleware(req, res, next) {
  res.locals.startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - res.locals.startTime;
    // Record metrics...
  });
  next();
}

app.get('/metrics', (req, res) => {
  res.set('Content-Type', registry.contentType);
  res.end(registry.metrics());
});
