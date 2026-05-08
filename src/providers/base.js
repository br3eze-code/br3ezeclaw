
/**
 * Base Provider
 */

class BaseProvider {
  constructor(options = {}) {
    this.name = 'base';
    this.config = options;
  }
  
  /**
   * Execute conversation with tools
   * Must be implemented by subclasses
   */
  async execute(conversation, tools) {
    throw new Error('execute() must be implemented by subclass');
  }
  
  /**
   * Format tools for provider-specific API
   */
  formatTools(tools) {
    // Default: return as-is
    return tools;
  }
  
  /**
   * Format conversation for provider-specific API
   */
  formatConversation(conversation) {
    // Default: return as-is
    return conversation;
  }
  
  /**
   * Parse provider-specific response
   */
  parseResponse(raw) {
    // Default: return as-is
    return raw;
  }
  
  /**
   * Get provider info
   */
  getInfo() {
    return {
      name: this.name,
      available: true,
      config: this.getSafeConfig()
    };
  }
  
  /**
   * Get config without sensitive data
   */
  getSafeConfig() {
    const safe = { ...this.config };
    delete safe.apiKey;
    delete safe.apiSecret;
    return safe;
  }
  
  /**
   * Generate unique ID
   */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = { BaseProvider };



