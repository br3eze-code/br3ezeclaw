/**
 * Base Channel

 */

const EventEmitter = require('events');

class BaseChannel extends EventEmitter {
  constructor(options = {}) {
    super();
    this.name = 'base';
    this.connected = false;
    this.options = options;
  }
  
  /**
   * Initialize and connect to channel
   */
  async connect() {
    throw new Error('connect() must be implemented by subclass');
  }
  
  /**
   * Disconnect from channel
   */
  async disconnect() {
    throw new Error('disconnect() must be implemented by subclass');
  }
  
  /**
   * Send message to recipient
   */
  async send(recipient, message) {
    throw new Error('send() must be implemented by subclass');
  }
  
  /**
   * Format message for channel-specific rendering
   */
  formatMessage(message) {
    if (typeof message === 'string') {
      return { text: message };
    }
    return message;
  }
  
  /**
   * Generate frame from channel-specific event
   */
  createFrame(event) {
    return {
      id: this.generateId(),
      sender: event.sender,
      senderName: event.senderName || event.sender,
      channel: this.name,
      content: event.content,
      timestamp: Date.now(),
      isDM: event.isDM !== undefined ? event.isDM : true,
      metadata: event.metadata || {}
    };
  }
  
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = { BaseChannel };

