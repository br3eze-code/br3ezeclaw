const { BaseDriver } = require('../base.js');
const { getManager } = require('../../core/mikrotik');
const { logger } = require('../../core/logger');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

class MikroTikSkill extends BaseDriver {
  static id = 'mikrotik';
  static name = 'MikroTik Manager';
  static description = 'Enterprise MikroTik RouterOS management skill with full intent parity';

  constructor(config, logger) {
    super(config, logger);
    this.manager = getManager();
  }

  /**
   * Dynamically build tool metadata from manifest.yaml
   */
  static getTools() {
    try {
      const manifestPath = path.join(__dirname, 'manifest.yaml');
      const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8'));
      
      const toolMap = {};
      manifest.tools.forEach(tool => {
        // Map manifest format to tool registry format
        const parameters = {
          type: 'object',
          properties: {},
          required: []
        };

        if (tool.parameters && Array.isArray(tool.parameters)) {
          tool.parameters.forEach(p => {
            parameters.properties[p.name] = {
              type: p.type || 'string',
              description: p.description || ''
            };
            if (p.required) {
              parameters.required.push(p.name);
            }
          });
        }

        toolMap[tool.name] = {
          description: tool.description,
          risk: this._calculateRisk(tool.name),
          parameters
        };
      });

      return toolMap;
    } catch (err) {
      logger.error('Failed to load MikroTik manifest for tools:', err);
      return {};
    }
  }

  static _calculateRisk(name) {
    if (name.includes('remove') || name.includes('kick') || name.includes('reboot') || name.includes('block')) {
      return 'high';
    }
    if (name.includes('add') || name.includes('flush')) {
      return 'medium';
    }
    return 'low';
  }

  async execute(toolName, args = {}, ctx = {}) {
    // 1. Ensure manager is available and connected
    if (!this.manager.state.isConnected) {
      logger.info('[MikroTikSkill] Not connected, attempting to connect...');
      const success = await this.manager.connect();
      if (!success) {
        throw new Error('Router disconnected. Check your network or firewall settings.');
      }
    }

    // 2. Normalize command name
    const command = toolName;
    
    logger.info(`[MikroTikSkill] Executing: ${command}`, { args });

    try {
      // 3. Delegate to central manager which handles connection pool and circuit breaker
      const result = await this.manager.executeTool(command, args);
      return result;
    } catch (err) {
      logger.error(`[MikroTikSkill] Execution failed: ${err.message}`);
      throw err;
    }
  }
}

module.exports = MikroTikSkill;
