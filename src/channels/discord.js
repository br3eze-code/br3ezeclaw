
/**
 * Discord Channel
 */

const { BaseChannel } = require('./base');
const { Logger } = require('../utils/logger');

class DiscordChannel extends BaseChannel {
  constructor(options = {}) {
    super(options);
    this.name = 'discord';
    this.token = options.token || process.env.DISCORD_BOT_TOKEN;
    this.clientId = options.clientId || process.env.DISCORD_CLIENT_ID;
    this.logger = new Logger('DiscordChannel');
    this.ws = null;
    this.sessionId = null;
    this.sequence = null;
  }
  
  async connect() {
    if (!this.token) {
      this.logger.info('Discord token not configured, skipping');
      return;
    }
    
    this.logger.info('Connecting to Discord...');
    
    // Connect to Discord Gateway
    const gatewayUrl = 'wss://gateway.discord.gg/?v=10&encoding=json';
    this.ws = new WebSocket(gatewayUrl);
    
    this.ws.on('open', () => {
      this.logger.info('Discord WebSocket connected');
    });
    
    this.ws.on('message', (data) => this.handleMessage(data));
    
    this.ws.on('close', () => {
      this.connected = false;
      this.logger.info('Discord disconnected');
    });
    
    this.ws.on('error', (error) => {
      this.logger.error('Discord error:', error);
    });
  }
  
  handleMessage(data) {
    const payload = JSON.parse(data);
    
    // Handle Hello (opcode 10)
    if (payload.op === 10) {
      this.identify();
      this.startHeartbeat(payload.d.heartbeat_interval);
    }
    
    // Handle Dispatch (opcode 0)
    if (payload.op === 0) {
      this.sequence = payload.s;
      
      if (payload.t === 'READY') {
        this.sessionId = payload.d.session_id;
        this.connected = true;
        this.logger.info('Discord ready');
      }
      
      if (payload.t === 'MESSAGE_CREATE') {
        this.handleDiscordMessage(payload.d);
      }
    }
  }
  
  identify() {
    this.ws.send(JSON.stringify({
      op: 2,
      d: {
        token: this.token,
        intents: 512, // Guild messages
        properties: {
          os: 'linux',
          browser: 'AgentOS',
          device: 'AgentOS'
        }
      }
    }));
  }
  
  startHeartbeat(interval) {
    setInterval(() => {
      this.ws.send(JSON.stringify({
        op: 1,
        d: this.sequence
      }));
    }, interval);
  }
  
  handleDiscordMessage(msg) {
    // Ignore bot messages
    if (msg.author?.bot) return;
    
    const isDM = msg.guild_id === null;
    const content = msg.content || '';
    
    // Only respond to mentions or DMs
    if (!isDM && !content.includes(`<@${this.clientId}>`)) {
      return;
    }
    
    // Remove mention from content
    const cleanContent = content.replace(new RegExp(`<@!?${this.clientId}>`, 'g'), '').trim();
    
    const frame = this.createFrame({
      sender: msg.channel_id,
      senderName: msg.author?.username || msg.author?.id,
      content: cleanContent,
      isDM,
      metadata: {
        messageId: msg.id,
        userId: msg.author?.id,
        guildId: msg.guild_id
      }
    });
    
    this.emit('message', frame);
  }
  
  async disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
  
  async send(recipient, message) {
    if (!this.connected) {
      throw new Error('Discord not connected');
    }
    
    const formatted = this.formatMessage(message);
    
    // Use Discord REST API to send message
    const response = await fetch(`https://discord.com/api/v10/channels/${recipient}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: formatted.text || formatted
      })
    });
    
    if (!response.ok) {
      throw new Error(`Discord API error: ${response.status}`);
    }
  }
}

module.exports = { DiscordChannel };

