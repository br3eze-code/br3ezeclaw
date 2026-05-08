/**
 * Slack Channel
 */

const { BaseChannel } = require('./base');
const { Logger } = require('../utils/logger');

class SlackChannel extends BaseChannel {
  constructor(options = {}) {
    super(options);
    this.name = 'slack';
    this.token = options.token || process.env.SLACK_BOT_TOKEN;
    this.signingSecret = options.signingSecret || process.env.SLACK_SIGNING_SECRET;
    this.logger = new Logger('SlackChannel');
  }
  
  async connect() {
    if (!this.token) {
      this.logger.info('Slack token not configured, skipping');
      return;
    }
    
    this.logger.info('Connecting to Slack...');
    
    // Verify connection
    const response = await fetch('https://slack.com/api/auth.test', {
      headers: { 'Authorization': `Bearer ${this.token}` }
    });
    
    const data = await response.json();
    if (data.ok) {
      this.connected = true;
      this.logger.info(`Slack connected as ${data.user}`);
    } else {
      throw new Error(`Slack auth failed: ${data.error}`);
    }
  }
  
  async disconnect() {
    this.connected = false;
  }
  
  async send(recipient, message) {
    if (!this.connected) {
      throw new Error('Slack not connected');
    }
    
    const formatted = this.formatMessage(message);
    
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channel: recipient,
        text: formatted.text || formatted,
        blocks: formatted.blocks
      })
    });
    
    const data = await response.json();
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }
  }
  
  /**
   * Handle incoming Slack events (for webhook mode)
   */
  handleEvent(event) {
    if (event.type === 'message' && !event.bot_id) {
      const isDM = event.channel_type === 'im';
      
      const frame = this.createFrame({
        sender: event.channel,
        senderName: event.user,
        content: event.text || '',
        isDM,
        metadata: {
          team: event.team,
          threadTs: event.thread_ts
        }
      });
      
      this.emit('message', frame);
    }
  }
}

module.exports = { SlackChannel };

