const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { logger } = require('../logger');
const { BaseChannel } = require('./BaseChannel');

class ChannelManager extends EventEmitter {
  constructor(agent) {
    super();
    this.agent = agent;
    this.channels = new Map();
    this._loadAdapters();
  }

  /**
   * Forces loading of all channel adapter files in the current directory
   * to ensure they execute their self-registration calls on BaseChannel.
   */
  _loadAdapters() {
    try {
      const files = fs.readdirSync(__dirname);
      for (const file of files) {
        if (
          file.endsWith('Channel.js') &&
          file !== 'BaseChannel.js' &&
          file !== 'ChannelManager.js'
        ) {
          try {
            require(path.join(__dirname, file));
            logger.debug(`ChannelManager: Loaded channel adapter ${file}`);
          } catch (err) {
            logger.error(`ChannelManager: Failed to load adapter ${file}:`, err.message);
          }
        }
      }
    } catch (err) {
      logger.error('ChannelManager: Error reading channel adapters directory:', err.message);
    }
  }

  async initialize() {
    logger.info('ChannelManager: Initializing channels from configuration...');

    const channelConfigs = this.agent.config.channels
      ? [...this.agent.config.channels]
      : [];

    // ── Fallback: detect channels from environment variables ────────────────
    if (channelConfigs.length === 0) {
      if (process.env.TELEGRAM_TOKEN) {
        channelConfigs.push({
          type: 'telegram',
          config: {
            token: process.env.TELEGRAM_TOKEN,
            allowed_ids: process.env.ALLOWED_CHAT_IDS
              ? process.env.ALLOWED_CHAT_IDS.split(',')
              : []
          }
        });
      }

      if (process.env.WHATSAPP_ENABLED !== 'false') {
        channelConfigs.push({
          type: 'whatsapp',
          config: {
            enabled: true,
            authStateFolder: process.env.WHATSAPP_AUTH_DIR || './data/whatsapp_auth',
            allowed_ids: process.env.ALLOWED_CHAT_IDS
              ? process.env.ALLOWED_CHAT_IDS.split(',')
              : []
          }
        });
      }
    }

    // ── Auto-detect additional channels from root config ────────────────────
    const autoChannels = ['slack', 'discord', 'email', 'sms', 'ussd'];
    for (const type of autoChannels) {
      if (this.agent.config[type]?.enabled && !channelConfigs.find(c => c.type === type)) {
        channelConfigs.push({
          type,
          config: this.agent.config[type]
        });
      }

      if (this.agent.config.email?.enabled && !channelConfigs.find(c => c.type === 'email')) {
        channelConfigs.push({
          type: 'email',
          config: this.agent.config.email
        });
      }

      if (this.agent.config.sms?.enabled && !channelConfigs.find(c => c.type === 'sms')) {
        channelConfigs.push({
          type: 'sms',
          config: this.agent.config.sms
        });
      }

      if (this.agent.config.ussd?.enabled && !channelConfigs.find(c => c.type === 'ussd')) {
        channelConfigs.push({
          type: 'ussd',
          config: this.agent.config.ussd
        });
      }

      for (const chan of channelConfigs) {
        logger.info(`ChannelManager: Registering ${chan.type} channel...`);
        await this.register(chan);
      }
    }

  static adapters = new Map();

  static registerAdapter(type, adapterClass) {
    ChannelManager.adapters.set(type, adapterClass);
  }

  async register(channelConfig) {
    const { type, config } = channelConfig;

    try {
      const ChannelClass = BaseChannel.getAdapter(type);
      if (!ChannelClass) {
        throw new Error(`Unknown or unregistered channel type: ${type}`);
      }

      // Destroy an existing channel of this type before re-registering
      if (this.channels.has(type)) {
        logger.info(`ChannelManager: Destroying existing ${type} channel before re-registering...`);
        try {
          await this.channels.get(type).destroy();
        } catch (err) {
          logger.warn(`ChannelManager: Error destroying previous ${type} channel: ${err.message}`);
        }
        this.channels.delete(type);
      }

      const channel = new ChannelClass(config, this.agent);

      // Route inbound messages through the agent
      channel.on('message', async (msg) => {
        const result = await this.agent.processInteraction(msg, {
          channel: type,
          channelId: channel.id
        });
        await channel.send(msg.userId, this.formatResponse(result));
      });

      // Bubble up special events
      channel.on('qr', (qr) => this.emit('qr', { channel: type, qr }));
      channel.on('command', (cmd) => this.emit('command', { channel: type, ...cmd }));
      channel.on('status', (status) => this.emit('status', { channel: type, status }));

      await channel.initialize();
      this.channels.set(type, channel);
      this.emit('channelRegistered', type);
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        logger.error(`✖ Failed to load ${type} channel: Missing dependency — ${error.message}`);
      } else {
        logger.error(`✖ Failed to initialize ${type} channel: ${error.message}`);
      }
      this.emit('channelError', { type, error });
    }
  }

  formatResponse(result) {
    if (!result.success) {
      return {
        text: `❌ ${result.error}`,
        suggestions: result.help ? [result.help] : undefined
      };
    }
    return {
      text: result.result?.text || JSON.stringify(result.result),
      buttons: result.result?.buttons,
      metadata: result.metadata
    };
  }

  async send(channelType, userId, message) {
    const channel = this.channels.get(channelType);
    if (!channel) throw new Error(`Channel not registered: ${channelType}`);
    return channel.send(userId, message);
  }

  async broadcast(message, filter = null) {
    const promises = [];
    for (const [type, channel] of this.channels) {
      if (filter && !filter(type)) continue;
      promises.push(channel.broadcast(message));
    }
    return Promise.allSettled(promises);
  }

  getStatus() {
    const status = {};
    for (const [type, channel] of this.channels) {
      status[type] = channel.getStatus();
    }
    return status;
  }

  getRegisteredTypes() {
    return BaseChannel.getRegisteredTypes();
  }

  async closeAll() {
    for (const [type, channel] of this.channels) {
      try {
        await channel.destroy();
      } catch (error) {
        logger.error(`Error closing channel ${type}:`, error);
      }
    }
    this.channels.clear();
  }
}

module.exports = ChannelManager;
