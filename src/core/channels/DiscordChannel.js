// src/core/channels/DiscordChannel.js
const { BaseChannel } = require('./BaseChannel');
const { Client, GatewayIntentBits, Partials } = require('discord.js');

class DiscordChannel extends BaseChannel {
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
  }

  async initialize() {
    this.client.once('ready', () => {
      this.connected = true;
      console.log(`Discord bot logged in as ${this.client.user.tag}`);
    });

    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      
      this.handleMessage({
        userId: message.author.id,
        channel: 'discord',
        channelId: message.channelId,
        guildId: message.guildId,
        text: message.content,
        isDM: !message.guild,
        raw: message
      });
    });

    await this.client.login(this.config.token);
  }

  async send(userId, message) {
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

module.exports = DiscordChannel;
