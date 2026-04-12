// src/core/channels/SlackChannel.js
const { BaseChannel } = require('./BaseChannel');
const { WebClient } = require('@slack/web-api');

class SlackChannel extends BaseChannel {
  constructor(config, agent) {
    super(config, agent);
    this.client = new WebClient(config.token);
    this.socketMode = config.socketMode || false;
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

  async initializeSocketMode() {
    const { SocketModeClient } = require('@slack/socket-mode');
    this.socket = new SocketModeClient({ appToken: this.config.appToken });
    
    this.socket.on('message', async ({ event, ack }) => {
      await ack();
      
      if (event.bot_id === this.botId) return; // Ignore own messages
      
      this.handleMessage({
        userId: event.user,
        channel: 'slack',
        channelId: event.channel,
        text: event.text,
        threadTs: event.thread_ts,
        ts: event.ts,
        raw: event
      });
    });
    
    await this.socket.start();
  }

  async send(userId, message) {
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

module.exports = SlackChannel;
