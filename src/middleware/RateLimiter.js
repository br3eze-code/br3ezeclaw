// src/middleware/RateLimiter.js
class RateLimiter {
  constructor(config = {}) {
    this.config = {
      windowMs: config.windowMs || 60000,
      maxRequests: config.maxRequests || 100,
      keyPrefix: config.keyPrefix || 'ratelimit:'
    };
    this.store = new Map();
  }

  async check(key) {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    const storeKey = this.config.keyPrefix + key;
    
    let requests = this.store.get(storeKey) || [];
    
    // Remove old requests
    requests = requests.filter(ts => ts > windowStart);
    
    if (requests.length >= this.config.maxRequests) {
      const retryAfter = Math.ceil((requests[0] + this.config.windowMs - now) / 1000);
      return {
        allowed: false,
        retryAfter,
        remaining: 0
      };
    }
    
    requests.push(now);
    this.store.set(storeKey, requests);
    
    // Cleanup old entries periodically
    if (Math.random() < 0.01) this.cleanup();
    
    return {
      allowed: true,
      remaining: this.config.maxRequests - requests.length,
      resetTime: now + this.config.windowMs
    };
  }

  cleanup() {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    
    for (const [key, requests] of this.store) {
      const filtered = requests.filter(ts => ts > windowStart);
      if (filtered.length === 0) {
        this.store.delete(key);
      } else {
        this.store.set(key, filtered);
      }
    }
  }
}



module.exports = { RateLimiter};
