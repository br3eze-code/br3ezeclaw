// src/core/agent.js

class Agent {
    constructor({ tools, events }) {
        this.tools = tools;
        this.events = events;
    }

    async handle(input) {
        // future AI layer
        const { tool, params } = input;

        return await this.tools.execute(tool, params);
    }
}

module.exports = Agent;