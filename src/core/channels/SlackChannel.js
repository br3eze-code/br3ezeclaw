// src/core/channels/SlackChannel.js
const { BaseChannel } = require('./BaseChannel');
const { WebClient } = require('@slack/web-api');

class SlackChannel extends BaseChannel {
  static getMetadata() {
    return {
      name: 'Slack',
      description: 'Team collaboration via Slack Bolt',
      configFields: [
        {
          "name": "token",
          "type": "password",
          "message": "Slack Bot Token (xoxb-):",
          "required": true
        },
        {
          "name": "appToken",
          "type": "password",
          "message": "Slack App Token (xapp-):",
          "required": true
        }
      ]
    };
  }

  async validateConfig() {
    if (!this.config.token || !this.config.appToken) {
      return { valid: false, error: 'Missing token or appToken' };
    }
    return { valid: true, error: null };
  }

  constructor(config, agent) {
    super(config, agent);
    this.client = new WebClient(config.token);
    this.socketMode = config.socketMode || false;
    this._registerHandlers();
  }

  async initialize() {
    // Verify connection
    const auth = await this.client.auth.test();
    this.botId = auth.user_id;
    this.teamId = auth.team_id;

    if (this.socketMode) {
      await this.initializeSocketMode();
    } else {
      await this.initializeEventSubscriptions();
    }

    this.connected = true;
  }

  async initializeEventSubscriptions() {
    // This mode requires a public URL and a separate HTTP server to receive webhooks.
    // In many edge cases, Socket Mode is preferred for its simplicity.
    console.warn('SlackChannel: Event Subscriptions mode requires a webhook handler (not yet fully implemented in core). Using Socket Mode is recommended for standalone agents.');
  }

  async initializeSocketMode() {
    const { SocketModeClient } = require('@slack/socket-mode');
    this.socket = new SocketModeClient({ appToken: this.config.appToken });

    this.socket.on('message', async ({ event, ack }) => {
      await ack();

      if (event.bot_id === this.botId) return; // Ignore own messages

      // Extract text
      const text = event.text || '';
      const from = event.channel;

      // Register active chat for broadcasts
      const { getChatRegistry } = require('../chat-registry');
      getChatRegistry().register('slack', from);

      // Command Dispatcher
      if (text.startsWith('/')) {
        const args = text.slice(1).trim().split(/\s+/);
        const cmdName = args[0].toLowerCase();
        const handler = this.handlers?.get(cmdName);

        if (handler) {
          const wrapped = this._rl(handler);
          await wrapped(from, event, args);
          return;
        }
      }

      const wrappedNL = this._rl(async (userId, msgEvent) => {
        this.emit('message', {
          userId: userId,
          channel: 'slack',
          channelId: msgEvent.channel,
          text: text,
          threadTs: msgEvent.thread_ts,
          ts: msgEvent.ts,
          raw: msgEvent
        });
      });
      await wrappedNL(event.user, event);
    });

    await this.socket.start();
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
          username: msg.user || jid,
          platform: 'slack',
          channels: { slack: jid }
        }).catch(e => console.warn(`Slack user sync failed: ${e.message}`));

        db.resolveFirebaseUser(jid, { channel: 'slack', channelId: jid }).catch(() => { });

        await fn.call(this, jid, msg, match);
      } catch (err) {
        console.error(`SlackChannel handler error: ${err.message}`, { jid });
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
    await this.send(jid, '👋 *Welcome to AgentOS for Slack!* Type `/menu` to see available commands.');
  }

  async _handleMenu(jid) {
    const text = `🤖 *AgentOS Menu*
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
    const payload = {
      channel: userId,
      text: message.text
    };

    if (message.blocks) {
      payload.blocks = message.blocks;
    }

    if (message.threadTs) {
      payload.thread_ts = message.threadTs;
    }

    const result = await this.client.chat.postMessage(payload);
    this.messageCount++;

    return { success: true, ts: result.ts };
  }

  async broadcast(message) {
    // Get all channels bot is member of
    const channels = await this.client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true
    });

    const promises = channels.channels
      .filter(c => c.is_member)
      .map(c => this.send(c.id, message));

    return Promise.allSettled(promises);
  }

  formatMessage(message) {
    if (typeof message === 'string') {
      return { text: message };
    }

    // Convert buttons to Slack blocks
    if (message.buttons) {
      return {
        text: message.text,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: message.text }
          },
          {
            type: 'actions',
            elements: message.buttons.map(b => ({
              type: 'button',
              text: { type: 'plain_text', text: b.label },
              action_id: b.action,
              value: JSON.stringify(b.data)
            }))
          }
        ]
      };
    }

    return message;
  }

  getStatus() {
    return {
      ...super.getStatus(),
      team: this.teamId,
      bot: this.botId,
      socketMode: this.socketMode
    };
  }

  async destroy() {
    if (this.socket) {
      await this.socket.disconnect();
    }
    super.destroy();
  }
}

BaseChannel.register('slack', SlackChannel);

module.exports = SlackChannel;
