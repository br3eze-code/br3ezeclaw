'use strict';

const WebSocket              = require('ws');

const crypto                 = require('crypto');
const { logger }             = require('./logger');
const { getConfig }          = require('./config');
const { getMikroTikClient }  = require('./mikrotik');

const CHUNK_SIZE = 50;

    // ── Gateway (ws) ──────────────────────────────────────────────────────────────────
class WebSocketGateway {
    constructor(server) {
        this.clients = new Map();
 
        this.wss = new WebSocket.Server({
            server,
            path: '/ws',
            verifyClient: this.verifyClient.bind(this)
        });
 
        this.setupHandlers();
        logger.info('WebSocket Gateway initialized on /ws');
    }


    // ── Auth ──────────────────────────────────────────────────────────────────
 
    verifyClient(info) {
        const url      = new URL(info.req.url, `http://${info.req.headers.host}`);
        const token    = url.searchParams.get('token') || info.req.headers['x-agentos-token'];
        const expected = getConfig().gateway?.token;
 
        if (!token || !expected) return false;
 
        try {
            // Constant-time comparison guards against timing attacks
            return (
                token.length === expected.length &&
                crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
            );
        } catch {
            return false;
        }
    }
 
 // ── Connection lifecycle ──────────────────────────────────────────────────
 
    setupHandlers() {
        this.wss.on('connection', (ws, req) => {
            const clientId = crypto.randomUUID();
            this.clients.set(clientId, { ws, authenticated: true });
 
            logger.info(`Client connected: ${clientId}`);
 
            this.send(ws, {
                type: 'hello',
                payload: {
                    service:   'AgentOS',
                    version:   getConfig().version,
                    timestamp: new Date().toISOString()
                }
            });
 
            ws.on('message', (data) => this.handleMessage(clientId, data));
            ws.on('close',   ()     => this.handleDisconnect(clientId));
            ws.on('error',   (err)  => logger.error(`WS error ${clientId}:`, err));
        });
    }
 
    handleDisconnect(clientId) {
        this.clients.delete(clientId);
        logger.info(`Client disconnected: ${clientId}`);
    }
    

   
    // ── Message dispatch ──────────────────────────────────────────────────────
 
    async handleMessage(clientId, data) {
        const client = this.clients.get(clientId);
        if (!client) return;
 
        try {
            const message = JSON.parse(data);
 
            switch (message.type) {
                case 'ping':
                    this.send(client.ws, { type: 'pong', timestamp: Date.now() });
                    break;
 
                case 'tool.invoke':
                    await this.handleToolInvoke(client, message);
                    break;
 
                case 'status':
                    await this.sendStatus(client);
                    break;
 
                case 'broadcast':
                    this.broadcast(message.payload);
                    break;
 
                default:
                    this.send(client.ws, {
                        type:     'error',
                        error:    'Unknown message type',
                        received: message.type
                    });
            }
        } catch (error) {
            logger.error('WS message error:', error);
        }
    }

    // ── Tool invocation ───────────────────────────────────────────────────────
 
    async handleToolInvoke(client, message) {
        const { tool, params, id, stream } = message;
 
        try {
            const mikrotik = await getMikroTikClient();
 
            if (stream && tool === 'users.all') {
                // Stream large datasets in chunks to avoid large single payloads
                const users = await mikrotik.getAllHotspotUsers();
                const total = Math.ceil(users.length / CHUNK_SIZE);
 
                for (let i = 0; i < users.length; i += CHUNK_SIZE) {
                    this.send(client.ws, {
                        type:  'tool.result.chunk',
                        id,
                        chunk: Math.floor(i / CHUNK_SIZE),
                        total,
                        data:  users.slice(i, i + CHUNK_SIZE)
                    });
                }
 
                this.send(client.ws, { type: 'tool.result.done', id });
            } else {
                const result = await mikrotik.executeTool(tool, ...(params || []));
                this.send(client.ws, { type: 'tool.result', id, result, success: true });
            }
        } catch (error) {
            this.send(client.ws, { type: 'tool.error', id, error: error.message, success: false });
        }
    }
    

   // ── Status ────────────────────────────────────────────────────────────────
 
    async sendStatus(client) {
        let mikrotikStatus = 'disconnected';
        try {
            const mt = await getMikroTikClient();
            mikrotikStatus = mt.isConnected ? 'connected' : 'disconnected';
        } catch { /* remain disconnected */ }
 
        this.send(client.ws, {
            type: 'status',
            payload: {
                mikrotik:  mikrotikStatus,
                clients:   this.clients.size,
                timestamp: new Date().toISOString()
            }
        });
    }
    
    // ── Helpers ───────────────────────────────────────────────────────────────
 
    send(ws, data) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
    }
 
    broadcast(payload) {
        this.clients.forEach(({ ws }) => this.send(ws, { type: 'broadcast', payload }));
    }
 
    close() {
        this.wss.close();
    }
}
 
module.exports = { WebSocketGateway };
