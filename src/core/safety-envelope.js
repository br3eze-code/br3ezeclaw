/**
 * Safety Envelope
 */

const { RateLimiterMemory } = require('rate-limiter-flexible');
const { Logger } = require('../utils/logger');

class SafetyEnvelope {
  constructor(options = {}) {
    this.logger = new Logger('SafetyEnvelope');
    
    // Rate limiter: max 100 requests per 15 minutes per sender
    this.rateLimiter = new RateLimiterMemory({
      keyPrefix: 'agentos',
      points: parseInt(process.env.RATE_LIMIT_MAX) || 100,
      duration: parseInt(process.env.RATE_LIMIT_WINDOW) || 900,
    });
    
    // Dangerous operations that require confirmation
    this.dangerousOperations = [
      'mikrotik.system.reboot',
      'mikrotik.system.reset',
      'mikrotik.firewall.drop',
      'system.shell.exec',
      'system.file.delete'
    ];
    
    // Blocked operations (never allowed)
    this.blockedOperations = [
      'system.shell.exec.rm',
      'system.shell.exec.sudo',
      'system.shell.exec.format'
    ];
    
    // Tool-specific policies
    this.policies = new Map();
  }
  
  /**
   * Check rate limit for sender
   */
  async checkRateLimit(sender) {
    try {
      await this.rateLimiter.consume(sender, 1);
      return true;
    } catch (rejRes) {
      this.logger.warn(`Rate limit exceeded for ${sender}`);
      return false;
    }
  }
  
  /**
   * Check if tool execution is allowed
   */
  checkToolExecution(toolName, params) {
    // Check blocked operations
    if (this.blockedOperations.some(op => toolName.includes(op))) {
      this.logger.error(`Blocked operation attempted: ${toolName}`);
      return false;
    }
    
    // Check dangerous operations
    if (this.dangerousOperations.includes(toolName)) {
      // In production, implement confirmation flow
      this.logger.warn(`Dangerous operation: ${toolName}`);
    }
    
    // Check custom policy
    const policy = this.policies.get(toolName);
    if (policy && !policy.validate(params)) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Register custom policy for tool
   */
  registerPolicy(toolName, validator) {
    this.policies.set(toolName, { validate: validator });
  }
  
  /**
   * Get execution limits for manifest
   */
  getLimits() {
    return {
      maxToolsPerRequest: 10,
      maxIterations: 10,
      dangerousOperations: this.dangerousOperations,
      blockedOperations: this.blockedOperations
    };
  }
}

module.exports = { SafetyEnvelope };

