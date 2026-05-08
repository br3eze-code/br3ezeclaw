// src/core/TelemetryCollector.js
class TelemetryCollector {
  constructor(config = {}) {
    this.config = {
      bufferSize: config.bufferSize || 100,
      flushInterval: config.flushInterval || 60000,
      endpoint: config.endpoint,
      ...config
    };
    this.buffer = [];
    this.metrics = new Map();
    this.flushTimer = null;
  }

  record(eventType, data) {
    const event = {
      type: eventType,
      timestamp: Date.now(),
      data
    };

    this.buffer.push(event);
    
    // Update in-memory metrics
    this.updateMetrics(eventType, data);

    if (this.buffer.length >= this.config.bufferSize) {
      this.flush();
    }
  }

  updateMetrics(type, data) {
    if (!this.metrics.has(type)) {
      this.metrics.set(type, {
        count: 0,
        lastValue: null,
        history: []
      });
    }
    
    const metric = this.metrics.get(type);
    metric.count++;
    metric.lastValue = data;
    metric.history.push({ ts: Date.now(), value: data });
    
    // Keep last 1000 entries
    if (metric.history.length > 1000) {
      metric.history.shift();
    }
  }

  start() {
    this.flushTimer = setInterval(() => this.flush(), this.config.flushInterval);
  }

  async flush() {
    if (this.buffer.length === 0) return;
    
    const batch = this.buffer.splice(0, this.buffer.length);
    
    try {
      if (this.config.endpoint) {
        await fetch(this.config.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events: batch })
        });
      }
      
      // Also log to file if configured
      if (this.config.logFile) {
        const fs = require('fs').promises;
        const lines = batch.map(e => JSON.stringify(e)).join('\n');
        await fs.appendFile(this.config.logFile, lines + '\n');
      }
    } catch (error) {
      console.error('Telemetry flush failed:', error);
      // Re-add to buffer for retry
      this.buffer.unshift(...batch);
    }
  }

  getMetrics(type) {
    return this.metrics.get(type);
  }

  stop() {
    clearInterval(this.flushTimer);
    this.flush(); // Final flush
  }
}

module.exports = TelemetryCollector;
