const WebSocket = require('ws');
const crypto = require('crypto');
const { logger } = require('../logger');
const { BaseChannel } = require('./BaseChannel');
const WebSocketCLI = require('./WebSocketCLI');

class WebSocketChannel extends BaseChannel {
    static getMetadata() {
        return {
            name: 'WebSocket',
            description: 'Messaging channel',
            configFields: []
        };
    }

  constructor(config, agent) {
    super(config, agent);
    this.server = config.server; // Existing Express server
    this.path = config.path || '/ws';
    this.wss = null;
    this.clients = new Map();
    this.cliSessions = new Map(); // clientId -> WebSocketCLI instance
  }

  async initialize() {
    if (!this.server) {
      logger.error('WebSocketChannel requires an HTTP server instance');
      return;
    }

    this.wss = new WebSocket.Server({
      server: this.server,
      path: this.path,
      verifyClient: this.verifyClient.bind(this),
      perMessageDeflate: false,    // CVE-2026-1526: disables memory-exhaustion vector
      maxPayload: 1024 * 1024,
      clientTracking: true
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
        crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
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

      case 'node.register':
        this._handleNodeRegister(clientId, client.ws, message.payload);
        break;

      case 'node.unregister':
        this._handleNodeUnregister(clientId);
        break;

      case 'command.invoke':
        this._handleCommandInvoke(clientId, client.ws, message);
        break;

      case 'tool.invoke':
        this._handleToolInvoke(clientId, client.ws, message);
        break;

      case 'tool.list':
        if (global.mikrotik) {
          this.sendToWs(client.ws, {
            type: 'tool.list',
            tools: global.mikrotik.getAvailableTools()
          });
        }
        break;

      case 'status':
        this.sendToWs(client.ws, { 
          type: 'status', 
          payload: this.getStatus() 
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

      case 'cli.start':
        this._handleCliStart(clientId);
        break;

      case 'cli.input':
        this._handleCliInput(clientId, message);
        break;

      case 'cli.stop':
        this.closeCliSession(clientId);
        break;

      case 'cli.resize':
        this._handleCliResize(clientId, message);
        break;

      case 'cli.exec':
        this._handleCliExec(clientId, message);
        break;
    }
  }

  _handleCliStart(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (this.cliSessions.has(clientId)) {
      this.cliSessions.get(clientId).destroy();
    }

    const session = new WebSocketCLI(clientId, client.ws, this);
    this.cliSessions.set(clientId, session);
    
    session.sendPrompt();
    this.sendToWs(client.ws, { 
      type: 'cli.started', 
      message: 'Interactive CLI session started. Type "exit" to quit.' 
    });
  }

  _handleCliInput(clientId, msg) {
    const session = this.cliSessions.get(clientId);
    if (session) {
      session.handleInput(msg.input || msg.payload?.input || '');
    }
  }

  _handleCliResize(clientId, msg) {
    const session = this.cliSessions.get(clientId);
    if (session) {
      session.resize(msg.cols || 80, msg.rows || 24);
    }
  }

  async _handleCliExec(clientId, msg) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    const command = msg.command || msg.payload?.command;
    if (!command) return;

    // Use AI coordinator to handle the command
    try {
      const result = await this.agent.processInteraction(command, {
        channel: 'websocket',
        userId: clientId,
        isCli: true
      });
      
      this.sendToWs(client.ws, {
        type: 'cli.result',
        id: msg.id,
        success: true,
        result: result.result?.text || JSON.stringify(result.result)
      });
    } catch (error) {
      this.sendToWs(client.ws, {
        type: 'cli.result',
        id: msg.id,
        success: false,
        error: error.message
      });
    }
  }

  closeCliSession(clientId) {
    const session = this.cliSessions.get(clientId);
    if (session) {
      session.destroy();
      this.cliSessions.delete(clientId);
      
      const client = this.clients.get(clientId);
      if (client) {
        this.sendToWs(client.ws, { type: 'cli.stopped' });
      }
    }
  }

  _handleNodeRegister(clientId, ws, payload) {
    const nodeInfo = {
      ...payload,
      clientId,
      ws,
      registeredAt: Date.now(),
      lastActivity: Date.now()
    };

    this.clients.set(clientId, nodeInfo);
    this.sendToWs(ws, {
      type: 'node.registered',
      payload: { nodeId: payload.nodeId, registeredAt: Date.now() }
    });

    logger.info(`Node registered: ${payload.nodeId} from ${clientId}`);
    this._broadcastNodeList();
  }

  _handleNodeUnregister(clientId) {
    this.clients.delete(clientId);
    this._broadcastNodeList();
  }

  _broadcastNodeList() {
    const nodes = [];
    this.clients.forEach((client) => {
      if (client.nodeId) {
        nodes.push({
          nodeId: client.nodeId,
          platform: client.platform,
          capabilities: client.capabilities,
          connectedAt: client.connectedAt || client.registeredAt
        });
      }
    });

    this.broadcast({ type: 'node.list', nodes, timestamp: Date.now() });
  }

  async _handleCommandInvoke(clientId, ws, msg) {
    const { command, params } = msg.payload;
    logger.info(`Command invoke: ${command} from ${clientId}`);
    
    // Relay to system
    this.emit('message', {
      text: command,
      params,
      userId: clientId,
      channel: 'websocket',
      raw: msg
    });
  }

  async _handleToolInvoke(clientId, ws, msg) {
    try {
      if (!global.mikrotik) throw new Error('MikroTik service unavailable');
      const result = await global.mikrotik.executeTool(msg.tool, msg.params || []);
      this.sendToWs(ws, {
        type: 'tool.result',
        id: msg.id,
        tool: msg.tool,
        result,
        success: true
      });
    } catch (error) {
      this.sendToWs(ws, {
        type: 'tool.result',
        id: msg.id,
        tool: msg.tool,
        error: error.message,
        success: false
      });
    }
  }

  handleDisconnect(clientId) {
    this.closeCliSession(clientId);
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

BaseChannel.register('websocket', WebSocketChannel);

module.exports = WebSocketChannel;
