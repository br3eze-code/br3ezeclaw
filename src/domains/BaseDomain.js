// src/domains/BaseDomain.js
const { logger } = require('../core/logger');

class BaseDomain {
  constructor() {
    this.name = 'base';
    this.tools = [];
  }

  registerTool(tool) {
    if (!tool.name || typeof tool.execute !== 'function') {
      logger.error(`Domain ${this.name}: Invalid tool registration attempted`);
      return;
    }
    this.tools.push(tool);
  }

  getSkills() {
    return this.tools;
  }

  // Placeholder for future planning logic
  async plan(intent) {
    return null;
  }
}

module.exports = BaseDomain;
