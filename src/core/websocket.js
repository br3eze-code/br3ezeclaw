const WebSocket = require('ws');
const crypto = require('crypto');
const { logger } = require('./logger');
const { getConfig } = require('./config');
const { getMikroTikClient } = require('./mikrotik');

class WebSocketGateway {
    constructor(server) {
        const config = getConfig().gateway;

        this.wss = new WebSocket.Server({
            server,
            path: '/ws',
            verifyClient: this.verifyClient.bind(this)
        });

        this.clients = new Map();
        this.setupHandlers();

        logger.info(`WebSocket Gateway initialized on /ws`);
    }

    verifyClient(info) {
        const url = new URL(info.req.url, `http://${info.req.headers.host}`);
        const token = url.searchParams.get('token') || info.req.headers['x-agentos-token'];
        const config = getConfig();
if (!token) return false;
         const expected = getConfig().gateway.token;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(token),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
        if (token !== config.gateway.token) {
            logger.warn('WebSocket auth failed');
            return false;
        }
        return true;
    }

    setupHandlers() {
        this.wss.on('connection', (ws, req) => {
            const clientId = require('crypto').randomUUID();
            this.clients.set(clientId, { ws, authenticated: true });

            logger.info(`Client connected: ${clientId}`);

            this.send(ws, {
                type: 'hello',
                payload: {
                    service: 'AgentOS',
                    version: getConfig().version,
                    timestamp: new Date().toISOString()
                }
            });

            ws.on('message', (data) => this.handleMessage(clientId, data));
            ws.on('close', () => this.handleDisconnect(clientId));
            ws.on('error', (err) => logger.error(`WS error ${clientId}:`, err));
        });
    }

    async handleMessage(clientId, data) {
        try {
            const message = JSON.parse(data);
            const client = this.clients.get(clientId);

            switch (message.type) {
                case 'ping':
                    this.send(client.ws, { type: 'pong', timestamp: Date.now() });
                    break;

                case 'tool.invoke':
                    await this.handleToolInvoke(client, message);
                    break;

                case 'status':
                    this.sendStatus(client);
                    break;

                case 'broadcast':
                    this.broadcast(message.payload);
                    break;

                default:
                    this.send(client.ws, {
                        type: 'error',
                        error: 'Unknown message type',
                        received: message.type
                    });
            }
        } catch (error) {
            logger.error('WS message error:', error);
        }
    }

    async handleToolInvoke(client, message) {
        const { tool, params, id } = message;

        try {
            const mikrotik = await getMikroTikClient();
            const result = await mikrotik.executeTool(tool, ...(params || []));

            this.send(client.ws, {
                type: 'tool.result',
                id,
                result,
                success: true
            });
        } catch (error) {
            this.send(client.ws, {
                type: 'tool.error',
                id,
                error: error.message,
                success: false
            });
        }
    }

    async sendStatus(client) {
        const mikrotik = await getMikroTikClient().catch(() => ({ isConnected: false }));

        this.send(client.ws, {
            type: 'status',
            payload: {
                mikrotik: mikrotik.isConnected ? 'connected' : 'disconnected',
                clients: this.clients.size,
                timestamp: new Date().toISOString()
            }
        });
    }

    send(ws, data) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    broadcast(payload) {
        this.clients.forEach(({ ws }) => {
            this.send(ws, { type: 'broadcast', payload });
        });
    }

    handleDisconnect(clientId) {
        this.clients.delete(clientId);
        logger.info(`Client disconnected: ${clientId}`);
    }

    close() {
        this.wss.close();
    }
}

module.exports = { WebSocketGateway };
