const WebSocket = require('ws');
const crypto = require('crypto');
const logger = require('../logger');
const { BaseChannel } = require('./BaseChannel');

class WebSocketChannel extends BaseChannel {
  constructor(config, agent) {
    super(config, agent);
    this.server = config.server; // Existing Express server
    this.path = config.path || '/ws';
    this.wss = null;
    this.clients = new Map();
  }

  async initialize() {
    if (!this.server) {
      logger.error('WebSocketChannel requires an HTTP server instance');
      return;
    }

    this.wss = new WebSocket.Server({
      server: this.server,
      path: this.path,
      verifyClient: this.verifyClient.bind(this)
    });

    this.wss.on('connection', (ws, req) => {
      const clientId = crypto.randomUUID();
      this.clients.set(clientId, { ws, authenticated: true });

      logger.info(`WebSocket client connected: ${clientId}`);

      // Hello message
      this.sendToWs(ws, {
        type: 'hello',
        payload: {
          service: 'AgentOS',
          version: '2026.4.11',
          timestamp: new Date().toISOString()
        }
      });

      ws.on('message', (data) => this.handleIncomingMessage(clientId, data));
      ws.on('close', () => this.handleDisconnect(clientId));
      ws.on('error', (err) => logger.error(`WebSocket error ${clientId}:`, err));
      
      this.connected = true;
    });

    logger.info(`WebSocket channel initialized on ${this.path}`);
  }

  verifyClient(info) {
    const url = new URL(info.req.url, `http://${info.req.headers.host}`);
    const token = url.searchParams.get('token') || info.req.headers['x-agentos-token'];
    const expected = this.config.token || (process.env.GATEWAY_TOKEN);

    if (!token || !expected) return false;

    try {
      return (
        token.length === expected.length &&
        crypto.timingSafeEqual(Buffer.Buffer.from(token), Buffer.Buffer.from(expected))
      );
    } catch {
      return false;
    }
  }

  async handleIncomingMessage(clientId, data) {
    this.messageCount++;
    try {
      const message = JSON.parse(data);
      
      // Standardize message for AgentOS
      if (message.type === 'interaction' || message.type === 'message') {
        this.emit('message', {
          text: message.text || message.payload?.text,
          userId: clientId,
          channel: 'websocket',
          raw: message
        });
      } else {
        // Handle other legacy message types (ping, status, etc.)
        this.handleLegacyMessage(clientId, message);
      }
    } catch (error) {
      logger.error('Failed to parse WebSocket message:', error);
    }
  }

  async handleLegacyMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (message.type) {
      case 'ping':
        this.sendToWs(client.ws, { type: 'pong', timestamp: Date.now() });
        break;
      case 'status':
        this.sendToWs(client.ws, { 
          type: 'status', 
          payload: this.agent.getStatus() 
        });
        break;
      case 'initiate-whatsapp':
        logger.info(`Received initiate-whatsapp from client ${clientId}`);
        this.emit('command', { 
          clientId, 
          command: 'initiate-whatsapp', 
          payload: message.payload 
        });
        break;
      // Add other legacy types if needed
    }
  }

  handleDisconnect(clientId) {
    this.clients.delete(clientId);
    logger.info(`WebSocket client disconnected: ${clientId}`);
    if (this.clients.size === 0) {
      this.connected = false;
    }
  }

  async send(userId, message) {
    const client = this.clients.get(userId);
    if (client) {
      this.sendToWs(client.ws, message);
    } else {
      // If userId is unknown, maybe it's a broadcast or we need to find the right client
      logger.warn(`WebSocket client ${userId} not found for sending`);
    }
  }

  async broadcast(message) {
    const payload = typeof message === 'string' ? { text: message } : message;
    this.clients.forEach(({ ws }) => {
      this.sendToWs(ws, { type: 'broadcast', payload });
    });
  }

  sendToWs(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  getStatus() {
    return {
      ...super.getStatus(),
      type: 'websocket',
      clients: this.clients.size
    };
  }

  async destroy() {
    if (this.wss) {
      this.wss.close();
    }
    await super.destroy();
  }
}

module.exports = WebSocketChannel;
