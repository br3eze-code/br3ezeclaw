// src/core/channels/DiscordChannel.js
const { BaseChannel } = require('./BaseChannel');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

class DiscordChannel extends BaseChannel {
  static getMetadata() {
    return {
      name: 'Discord',
      description: 'Community alerts via Discord.js',
      configFields: [
        {
          "name": "token",
          "type": "password",
          "message": "Discord Bot Token:",
          "required": true
        }
      ]
    };
  }

  async validateConfig() {
    if (!this.config.token) {
      return { valid: false, error: 'Missing token' };
    }
    return { valid: true, error: null };
  }

  constructor(config, agent) {
    super(config, agent);
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
      ],
      partials: [Partials.Channel]
    });
    this._registerHandlers();
  }

  async initialize() {
    this.client.once('ready', () => {
      this.connected = true;
      console.log(`Discord bot logged in as ${this.client.user.tag}`);
    });

    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;

      const text = message.content || '';
      const from = message.channelId;

      // Register active chat for broadcasts
      const { getChatRegistry } = require('../chat-registry');
      getChatRegistry().register('discord', from);

      // Command Dispatcher
      if (text.startsWith('/')) {
        const args = text.slice(1).trim().split(/\s+/);
        const cmdName = args[0].toLowerCase();
        const handler = this.handlers?.get(cmdName);

        if (handler) {
          const wrapped = this._rl(handler);
          await wrapped(from, message, args);
          return;
        }
      }

      const wrappedNL = this._rl(async (userId, msgEvent) => {
        this.emit('message', {
          userId: userId,
          channel: 'discord',
          channelId: msgEvent.channelId,
          guildId: msgEvent.guildId,
          text: text,
          isDM: !msgEvent.guild,
          raw: msgEvent
        });
      });
      await wrappedNL(message.author.id, message);
    });

    await this.client.login(this.config.token);
  }

  _rl(fn) {
    return async (jid, msg, match) => {
      try {
        if (!this.isAuthorized(jid)) {
          return this.send(jid, '🚫 *Unauthorized.* Your ID is not in the allowed list.');
        }

        const { getDatabase } = require('../database');
        const db = await getDatabase();
        
        await db.upsertUser(jid, {
          username: msg.author?.username || jid,
          platform: 'discord',
          channels: { discord: jid }
        }).catch(e => console.warn(`Discord user sync failed: ${e.message}`));

        db.resolveFirebaseUser(jid, { channel: 'discord', channelId: jid }).catch(() => { });

        await fn.call(this, jid, msg, match);
      } catch (err) {
        console.error(`DiscordChannel handler error: ${err.message}`, { jid });
        await this.send(jid, `❌ *Error:* ${err.message}`).catch(() => { });
      }
    };
  }

  _registerHandlers() {
    this.handlers = new Map();
    const H = require('./HandlerLibrary');

    this.handlers.set('start', this._handleStart);
    this.handlers.set('menu', this._handleMenu);
    this.handlers.set('dashboard', (j) => H.handleDashboard(this, j));
    this.handlers.set('stats', (j) => H.handleStats(this, j));
    this.handlers.set('network', (j) => H.handleNetwork(this, j));
    this.handlers.set('users', (j) => H.handleUsers(this, j));
    this.handlers.set('voucher', (j, m, a) => H.handleVoucher(this, j, m, a));
    this.handlers.set('bulk', (j, m, a) => H.handleBulkVoucher(this, j, m, a));
    this.handlers.set('ping', (j) => H.handlePing(this, j));
  }

  async _handleStart(jid) {
    await this.send(jid, '👋 **Welcome to AgentOS for Discord!** Type `/menu` to see available commands.');
  }

  async _handleMenu(jid) {
    const text = `🤖 **AgentOS Menu**
/dashboard - System Overview
/stats - Hardware Telemetry
/network - Interface & DHCP Status
/users - Active Hotspot Users
/voucher <plan> - Create a single voucher
/bulk <plan> <qty> - Create multiple vouchers
/ping - Connectivity Test
/help - Show help`;
    await this.send(jid, text);
  }

  async send(userId, message) {
    message = this.formatMessage(message);
    const channel = await this.client.channels.fetch(userId);

    const payload = {
      content: message.text
    };

    if (message.embeds) {
      payload.embeds = message.embeds.map(e => ({
        title: e.title,
        description: e.description,
        color: e.color,
        fields: e.fields
      }));
    }

    if (message.components) {
      payload.components = message.components;
    }

    const result = await channel.send(payload);
    this.messageCount++;

    return { success: true, id: result.id };
  }

  async broadcast(message) {
    // Send to all guilds the bot is in
    const promises = [];

    for (const guild of this.client.guilds.cache.values()) {
      // Find first text channel where bot can send messages
      const channel = guild.channels.cache.find(
        c => c.type === 0 && c.permissionsFor(this.client.user).has('SendMessages')
      );

      if (channel) {
        promises.push(this.send(channel.id, message));
      }
    }

    return Promise.allSettled(promises);
  }

  formatMessage(message) {
    if (typeof message === 'string') {
      return { text: message };
    }

    // Convert to Discord embed format
    if (message.buttons) {
      return {
        text: message.text,
        embeds: [{
          description: message.text,
          color: 0x0099ff
        }],
        components: [{
          type: 1,
          components: message.buttons.map(b => ({
            type: 2,
            label: b.label,
            style: 1,
            custom_id: b.action
          }))
        }]
      };
    }

    return message;
  }

  getStatus() {
    return {
      ...super.getStatus(),
      guilds: this.client.guilds?.cache.size || 0,
      users: this.client.users?.cache.size || 0
    };
  }

  async destroy() {
    this.client.destroy();
    super.destroy();
  }
}

BaseChannel.register('discord', DiscordChannel);

module.exports = DiscordChannel;
