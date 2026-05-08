
/**
 * WebSocket Channel
 */

const { BaseChannel } = require('./base');
const { Logger } = require('../utils/logger');

class WebSocketChannel extends BaseChannel {
  constructor(options = {}) {
    super(options);
    this.name = 'websocket';
    this.logger = new Logger('WebSocketChannel');
    this.clients = new Map();
  }
  
  async connect() {
    // WebSocket is managed by Gateway
    this.connected = true;
  }
  
  async disconnect() {
    for (const [id, client] of this.clients) {
      client.close();
    }
    this.clients.clear();
    this.connected = false;
  }
  
  registerClient(clientId, ws) {
    this.clients.set(clientId, ws);
    
    ws.on('close', () => {
      this.clients.delete(clientId);
    });
  }
  
  async send(recipient, message) {
    const client = this.clients.get(recipient);
    if (!client) {
      throw new Error(`WebSocket client not found: ${recipient}`);
    }
    
    if (client.readyState === 1) { // OPEN
      client.send(JSON.stringify(this.formatMessage(message)));
    }
  }
  
  formatMessage(message) {
    if (typeof message === 'string') {
      return { type: 'message', content: message };
    }
    return { type: 'response', ...message };
  }
}

module.exports = { WebSocketChannel };

