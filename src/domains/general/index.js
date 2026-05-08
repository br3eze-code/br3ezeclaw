const BaseDomain = require('../BaseDomain');
const crypto = require('crypto');

class GeneralDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'general';

    this.registerTool({
      name: 'now',
      description: 'Get current ISO timestamp',
      execute: async () => new Date().toISOString()
    });

    this.registerTool({
      name: 'uuid',
      description: 'Generate a v4 UUID',
      execute: async () => crypto.randomUUID()
    });

    this.registerTool({
      name: 'hash',
      description: 'Generate a SHA-256 hash',
      execute: async (str) => crypto.createHash('sha256').update(String(str)).digest('hex')
    });

    this.registerTool({
      name: 'safeMath',
      description: 'Perform safe arithmetic',
      execute: async (op, a, b) => {
        switch(op) {
          case 'add': return a + b;
          case 'sub': return a - b;
          case 'mul': return a * b;
          case 'div': return b !== 0 ? a / b : 'Infinity';
          default: throw new Error(`Unknown operator: ${op}`);
        }
      }
    });
  }
}

module.exports = GeneralDomain;
