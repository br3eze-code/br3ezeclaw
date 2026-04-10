// src/core/eventBus.js

const EventEmitter = require('events');

class AgentBus extends EventEmitter { }
const eventBus = new AgentBus();

module.exports = eventBus;