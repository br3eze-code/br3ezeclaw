// src/channels/BaseChannel.js
class BaseChannel {
  constructor(config) {
    this.config = config;
    this.messageHandler = null;
  }

  async send(userId, message) { throw new Error('Not implemented'); }
  async broadcast(message) { throw new Error('Not implemented'); }
  onMessage(handler) { this.messageHandler = handler; }
  
  formatButtons(buttons) {
    return buttons.map(b => ({
      text: b.label,
      action: b.action,
      data: b.data
    }));
  }
}
