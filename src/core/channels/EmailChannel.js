// src/core/channels/EmailChannel.js
const { BaseChannel } = require('./BaseChannel');

class EmailChannel extends BaseChannel {
    static getMetadata() {
        return {
            name: 'Email',
            description: 'Professional comms via SMTP/IMAP',
            configFields: [
        {
                "name": "host",
                "type": "input",
                "message": "SMTP Host:",
                "default": "smtp.gmail.com"
        },
        {
                "name": "user",
                "type": "input",
                "message": "Email User:",
                "required": true
        },
        {
                "name": "pass",
                "type": "password",
                "message": "Email Pass:",
                "required": true
        }
]
        };
    }

  constructor(config, agent) {
    super(config, agent);
    this.provider = config.provider || 'smtp';
    // config could contain smtp credentials or api keys for sendgrid/mailgun etc.
    this._registerHandlers();
  }

  async initialize() {
    this.connected = true;
    console.log(`EmailChannel initialized using provider: ${this.provider}`);

    if (this.provider === 'smtp') {
      try {
        const nodemailer = require('nodemailer');
        this.transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'localhost',
          port: parseInt(process.env.SMTP_PORT) || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
          }
        });
        console.log('EmailChannel: nodemailer transporter created.');
      } catch (err) {
        console.warn(`EmailChannel: Failed to initialize nodemailer - ${err.message}`);
      }
    }
  }

  _rl(fn) {
    return async (emailAddress, msg, match) => {
      try {
        if (!this.isAuthorized(emailAddress)) {
          return this.send(emailAddress, { subject: 'Unauthorized', text: 'Your email address is not in the allowed list.' });
        }

        const { getDatabase } = require('../database');
        const db = await getDatabase();

        await db.upsertUser(emailAddress, {
          username: emailAddress,
          platform: 'email',
          channels: { email: emailAddress }
        }).catch(e => console.warn(`Email user sync failed: ${e.message}`));

        db.resolveFirebaseUser(emailAddress, { channel: 'email', channelId: emailAddress }).catch(() => { });

        await fn.call(this, emailAddress, msg, match);
      } catch (err) {
        console.error(`EmailChannel handler error: ${err.message}`, { emailAddress });
        await this.send(emailAddress, { subject: 'Error', text: `Error: ${err.message}` }).catch(() => { });
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
    this.handlers.set('ping', (j) => H.handlePing(this, j));
  }

  async _handleStart(emailAddress) {
    await this.send(emailAddress, { subject: 'Welcome to AgentOS', text: 'Welcome to AgentOS via Email! Reply with "menu" to see available commands.' });
  }

  async _handleMenu(emailAddress) {
    const text = `AgentOS Menu:\ndashboard\nstats\nnetwork\nusers\nping\nhelp`;
    await this.send(emailAddress, { subject: 'AgentOS Menu', text });
  }

  async handleIncomingEmail(emailAddress, subject, text, rawData = {}) {
    const { getChatRegistry } = require('../chat-registry');
    getChatRegistry().register('email', emailAddress);

    const safeSubject = subject || '';
    const safeText = text || '';

    // simple command detection from subject or first line of text
    const cmdInput = safeSubject.startsWith('/') ? safeSubject : safeText.trim().split('\n')[0];
    const cmdName = cmdInput.replace('/', '').trim().toLowerCase().split(/\s+/)[0];
    
    const handler = this.handlers?.get(cmdName);

    if (handler) {
      const args = cmdInput.trim().split(/\s+/).slice(1);
      const wrapped = this._rl(handler);
      await wrapped(emailAddress, rawData, args);
      return;
    }

    const wrappedNL = this._rl(async (emailAddr, rawMsg) => {
      this.emit('message', {
        userId: emailAddr,
        channel: 'email',
        channelId: emailAddr,
        text: text,
        subject: subject,
        raw: rawMsg
      });
    });
    
    await wrappedNL(emailAddress, rawData);
  }

  async send(userId, message) {
    message = this.formatMessage(message);
    let subject = message.subject || 'Message from AgentOS';
    let text = message.text || '';
    
    console.log(`[Email to ${userId}] Subject: ${subject}\nBody: ${text}`);

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: process.env.SMTP_FROM || 'agentos@localhost',
          to: userId,
          subject: subject,
          text: text
        });
      } catch (err) {
        console.error(`EmailChannel failed to send to ${userId}: ${err.message}`);
        return { success: false, error: err.message };
      }
    }

    this.messageCount++;
    return { success: true };
  }

  async broadcast(message) {
    const { getChatRegistry } = require('../chat-registry');
    const emails = getChatRegistry().getChats('email');
    if (!emails || emails.length === 0) return { success: true, sentCount: 0 };
    
    console.log(`[Email Broadcast] sending to ${emails.length} users.`);
    const promises = emails.map(email => this.send(email, message));
    const results = await Promise.allSettled(promises);
    return { 
      success: true, 
      sentCount: results.filter(r => r.status === 'fulfilled' && r.value?.success).length 
    };
  }

  getStatus() {
    return {
      ...super.getStatus(),
      provider: this.provider
    };
  }
}

BaseChannel.register('email', EmailChannel);

module.exports = EmailChannel;
