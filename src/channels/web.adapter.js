'use strict';

const { WebSocketServer } = require('ws');

class WebAdapter {
    constructor(server) {
        this.wss = new WebSocketServer({ server, path: '/ws/pairing' });
        this.clients = new Map(); // sessionId -> ws
        
        this.wss.on('connection', (ws, req) => {
            const sessionId = new URL(req.url, 'http://localhost').searchParams.get('session');
            if (sessionId) {
                this.clients.set(sessionId, ws);
                
                ws.on('close', () => this.clients.delete(sessionId));
                ws.on('message', (data) => this.handleMessage(sessionId, data));
            }
        });
    }

    async send(sessionId, message) {
        const ws = this.clients.get(sessionId);
        if (!ws || ws.readyState !== 1) return false; // WebSocket.OPEN = 1
        
        ws.send(JSON.stringify({
            type: typeof message === 'string' ? 'notification' : message.type,
            timestamp: Date.now(),
            payload: typeof message === 'string' ? { text: message } : message
        }));
        
        return true;
    }

    format(template, data) {
        return {
            type: `pairing.${template}`,
            data
        };
    }

    handleMessage(sessionId, data) {
        // Handle web client commands
        try {
            const msg = JSON.parse(data);
            // Emit to pairing service
        } catch (e) {
            // Invalid JSON
        }
    }

    broadcast(message) {
        this.wss.clients.forEach(ws => {
            if (ws.readyState === 1) {
                ws.send(JSON.stringify(message));
            }
        });
    }
}

module.exports = WebAdapter;
