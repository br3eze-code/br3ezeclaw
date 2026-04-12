// src/core/channels/BaseChannel.js
class BaseChannel extends EventEmitter {
  constructor(config, agent) {
    super();
    this.config = config;
    this.agent = agent;
    this.id = crypto.randomUUID();
    this.connected = false;
    this.messageCount = 0;
    this.errorCount = 0;
  }

  async initialize() {
    throw new Error('Not implemented');
  }

  async send(userId, message) {
    throw new Error('Not implemented');
  }

  async broadcast(message) {
    throw new Error('Not implemented');
  }

  formatMessage(message) {
    // Default formatting - override in subclasses
    if (typeof message === 'string') {
      return { text: message };
    }
    return message;
  }

  getStatus() {
    return {
      id: this.id,
      connected: this.connected,
      messages: this.messageCount,
      errors: this.errorCount
    };
  }

  async destroy() {
    this.removeAllListeners();
  }
}

module.exports = {BaseChannel };
