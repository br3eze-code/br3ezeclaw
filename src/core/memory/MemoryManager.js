// src/core/memory/MemoryManager.js
class MemoryManager {
  constructor(adapter = 'memory') {
    this.adapter = this.createAdapter(adapter);
  }

  createAdapter(type) {
    switch (type) {
      case 'memory':
        return new (require('./adapters/MemoryAdapter'))();
      case 'firebase':
        return new (require('./adapters/FirebaseAdapter'))();
      case 'redis':
        return new (require('./adapters/RedisAdapter'))();
      case 'sqlite':
        return new (require('./adapters/SQLiteAdapter'))();
      default:
        throw new Error(`Unknown memory adapter: ${type}`);
    }
  }

  async initialize() {
    return this.adapter.initialize();
  }

  async getUserContext(userId) {
    return this.adapter.get(`user:${userId}:context`) || {};
  }

  async storeInteraction(interactionId, data) {
    // Store in user history
    const userId = data.context.userId;
    await this.adapter.push(`user:${userId}:history`, {
      id: interactionId,
      timestamp: data.timestamp,
      skill: data.result?.skill,
      input: data.input.text || data.input.action
    });
    
    // Keep only last 100 interactions
    await this.adapter.trim(`user:${userId}:history`, -100);
    
    // Store full interaction
    await this.adapter.set(`interaction:${interactionId}`, data, 86400); // 24h TTL
  }

  async getSession(sessionId) {
    if (!sessionId) return null;
    return this.adapter.get(`session:${sessionId}`);
  }

  async createSession(userId, data = {}) {
    const sessionId = crypto.randomUUID();
    await this.adapter.set(`session:${sessionId}`, {
      userId,
      createdAt: Date.now(),
      data
    }, 3600); // 1h TTL
    return sessionId;
  }

  async getPermissions(userId) {
    const perms = await this.adapter.get(`user:${userId}:permissions`);
    return perms || ['user:read'];
  }

  async setPermissions(userId, permissions) {
    return this.adapter.set(`user:${userId}:permissions`, permissions);
  }

  async close() {
    return this.adapter.close();
  }

  getStatus() {
    return this.adapter.getStatus();
  }
}

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

module.exports = { MemoryManager, MemoryAdapter };