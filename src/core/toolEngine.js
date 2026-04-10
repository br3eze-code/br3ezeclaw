// src/core/toolEngine.js

class ToolEngine {
    constructor() {
        this.tools = new Map();
    }

    register(name, handler) {
        this.tools.set(name, handler);
    }

    async execute(name, params = {}) {
        if (!this.tools.has(name)) {
            throw new Error(`Tool not found: ${name}`);
        }

        return await this.tools.get(name)(params);
    }

    list() {
        return Array.from(this.tools.keys());
    }
}

module.exports = new ToolEngine();