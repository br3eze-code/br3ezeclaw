// src/core/memory/adapters/MemoryAdapter.js
class MemoryAdapter {
  constructor() {
    this.store = new Map();
    this.timers = new Map();
  }

  async initialize() {
    // Cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  async get(key) {
    return this.store.get(key);
  }

  async set(key, value, ttlSeconds = null) {
    this.store.set(key, value);
    
    if (ttlSeconds) {
      if (this.timers.has(key)) {
        clearTimeout(this.timers.get(key));
      }
      const timer = setTimeout(() => this.store.delete(key), ttlSeconds * 1000);
      this.timers.set(key, timer);
    }
  }

  async push(key, value) {
    const arr = this.store.get(key) || [];
    arr.push(value);
    this.store.set(key, arr);
  }

  async trim(key, count) {
    const arr = this.store.get(key) || [];
    if (count < 0) {
      this.store.set(key, arr.slice(count));
    } else {
      this.store.set(key, arr.slice(0, count));
    }
  }

  cleanup() {
    // Memory adapter handles TTL via timers
  }

  async close() {
    clearInterval(this.cleanupInterval);
    this.store.clear();
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  getStatus() {
    return {
      type: 'memory',
      keys: this.store.size,
      memoryUsage: process.memoryUsage().heapUsed
    };
  }
}

module.exports = MemoryAdapter;