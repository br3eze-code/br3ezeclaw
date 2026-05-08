const readline = require('readline');
const { logger } = require('../logger');
const { BaseChannel } = require('./BaseChannel');

class CLIChannel extends BaseChannel {
    static getMetadata() {
        return {
            name: 'CLI',
            description: 'Messaging channel',
            configFields: []
        };
    }

  constructor(config, agent) {
    super(config, agent);
    this.rl = null;
  }

  async initialize() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'AgentOS> '
    });

    this.rl.on('line', async (line) => {
      const text = line.trim();
      if (!text) {
        this.rl.prompt();
        return;
      }

      if (text.toLowerCase() === 'exit' || text.toLowerCase() === 'quit') {
        this.agent.emit('shutdown');
        return;
      }

      this.messageCount++;
      this.emit('message', {
        text,
        userId: 'cli-user',
        channel: 'cli',
        raw: line
      });
    });

    this.rl.on('close', () => {
      logger.info('CLI session closed');
      this.connected = false;
    });

    this.connected = true;
    this.rl.prompt();
    logger.info('CLI channel initialized');
  }

  async send(userId, message) {
    const text = typeof message === 'string' ? message : (message.text || JSON.stringify(message));
    process.stdout.write(`\n${text}\n`);
    if (this.rl) this.rl.prompt();
  }

  async broadcast(message) {
    await this.send('all', message);
  }

  getStatus() {
    return {
      ...super.getStatus(),
      type: 'cli'
    };
  }

  async destroy() {
    if (this.rl) {
      this.rl.close();
    }
    await super.destroy();
  }
}

BaseChannel.register('cli', CLIChannel);

module.exports = CLIChannel;
