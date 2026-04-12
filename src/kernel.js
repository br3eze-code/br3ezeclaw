'use strict';
/**
 * AgentKernel — Thin event-emitting orchestrator
 * @module kernel
 * @version 2026.03.27
 */
const tools = require('./tools');

const EventEmitter = require('events');
const { getManager } = require('./core/mikrotik');
 
class AgentKernel extends EventEmitter {
    constructor() {
        super();
        this.state = {
            mikrotik: 'disconnected',
            power:    'stable',
            clients:  0
        };
    }
 
    async execute(toolName, params = {}) {
        const mikrotik = getManager();
 
        if (!mikrotik.state.isConnected) {
            throw new Error('Router offline — cannot execute tool');
        }
 
        this.emit('command:run', { tool: toolName, params });
        const result = await mikrotik.executeTool(toolName, params);
        this.emit('command:done', { tool: toolName, result });
        return result;
    }
}

module.exports = AgentKernel;
