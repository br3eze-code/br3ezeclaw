const EventEmitter = require('events');
const tools = require('./tools');

class AgentKernel extends EventEmitter {
    constructor() {
        super();
        this.state = {
            mikrotik: 'disconnected',
            power: 'stable',
            clients: 0
        };
    }

    // Centralized command execution for all listeners
    async execute(toolName, params) {
        if (this.state.mikrotik !== 'connected') {
            throw new Error("Router Offline");
        }
        this.emit('command:run', { tool: toolName, params });
        return await tools[toolName](this.mikrotik_conn, ...params);
    }
}

module.exports = AgentKernel;