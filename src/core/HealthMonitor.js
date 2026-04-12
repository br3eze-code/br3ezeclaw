// src/core/HealthMonitor.js
class HealthMonitor {
  constructor() {
    this.metrics = {
      telegram: { status: 'unknown', lastPing: null },
      whatsapp: { status: 'unknown', lastPing: null },
      websocket: { connections: 0, messagesPerMinute: 0 },
      mikrotik: { activePools: 0, queuedCommands: 0 }
    };
  }

  getStatus() {
    return {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      channels: this.metrics,
      healthy: this.isHealthy()
    };
  }

  isHealthy() {
    return Object.values(this.metrics).every(m => 
      m.status !== 'error' && m.status !== 'disconnected'
    );
  }
}
