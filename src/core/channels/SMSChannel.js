// src/core/channels/SMSChannel.js
const { BaseChannel } = require('./BaseChannel');
const https = require('https');
const http = require('http');

class SMSChannel extends BaseChannel {
    static getMetadata() {
        return {
            name: 'SMS',
            description: 'Direct SMS delivery via local gateway or Twilio',
            configFields: [
        {
                "name": "gatewayUrl",
                "type": "input",
                "message": "Gateway URL:",
                "default": "http://localhost:8080"
        }
]
        };
    }

  constructor(config, agent) {
    super(config, agent);
    this.provider = config.provider || 'twilio';
    this._registerHandlers();
  }

  async initialize() {
    this.connected = true;
    console.log(`SMSChannel initialized using provider: ${this.provider}`);

    if (this.provider === 'twilio') {
      try {
        const twilio = require('twilio');
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        if (accountSid && authToken) {
          this.client = twilio(accountSid, authToken);
          this.fromNumber = process.env.TWILIO_FROM_NUMBER;
          console.log('SMSChannel: Twilio client initialized.');
        } else {
          console.warn('SMSChannel: Twilio credentials not found in environment.');
        }
      } catch (err) {
        console.warn(`SMSChannel: Failed to initialize twilio - ${err.message}`);
      }
    }

    if (this.provider === 'econet') {
      this._econet = {
        baseUrl: process.env.ECONET_BASE_URL || 'https://api.econet.co.zw',
        clientId: process.env.ECONET_CLIENT_ID,
        clientSecret: process.env.ECONET_CLIENT_SECRET,
        fromName: process.env.ECONET_FROM_NAME || 'AgentOS',
        token: null,
        tokenExpiry: 0
      };
      if (!this._econet.clientId || !this._econet.clientSecret) {
        console.warn('SMSChannel: Econet A2A credentials not found (ECONET_CLIENT_ID / ECONET_CLIENT_SECRET).');
      } else {
        console.log('SMSChannel: Econet A2A provider configured.');
      }
    }
  }

  _rl(fn) {
    return async (phoneNumber, msg, match) => {
      try {
        if (!this.isAuthorized(phoneNumber)) {
          return this.send(phoneNumber, 'Unauthorized. Your number is not in the allowed list.');
        }

        const { getDatabase } = require('../database');
        const db = await getDatabase();

        await db.upsertUser(phoneNumber, {
          username: phoneNumber,
          platform: 'sms',
          channels: { sms: phoneNumber }
        }).catch(e => console.warn(`SMS user sync failed: ${e.message}`));

        // Resolve (or auto-provision) the Firebase Auth user for this phone number,
        // then build a scoped UserDoc so handlers can only touch their own doc.
        const authUser = await db.resolveFirebaseUser(phoneNumber, {
          channel: 'sms',
          channelId: phoneNumber
        }).catch(() => null);

        const userDoc = authUser?.uid ? db.getUserDoc(authUser.uid) : null;

        // Attach to context so any handler can do: ctx.userDoc.update({...})
        const ctx = { phoneNumber, userDoc, uid: authUser?.uid || null, db };

        await fn.call(this, phoneNumber, msg, match, ctx);
      } catch (err) {
        console.error(`SMSChannel handler error: ${err.message}`, { phoneNumber });
        await this.send(phoneNumber, `Error: ${err.message}`).catch(() => { });
      }
    };
  }

  _registerHandlers() {
    this.handlers = new Map();
    const H = require('./HandlerLibrary');
    
    this.handlers.set('start', this._handleStart.bind(this));
    this.handlers.set('menu', this._handleMenu.bind(this));
    this.handlers.set('dashboard', (j) => H.handleDashboard(this, j));
    this.handlers.set('stats', (j) => H.handleStats(this, j));
    this.handlers.set('network', (j) => H.handleNetwork(this, j));
    this.handlers.set('users', (j) => H.handleUsers(this, j));
    this.handlers.set('ping', (j) => H.handlePing(this, j));
  }

  async _handleStart(phoneNumber) {
    await this.send(phoneNumber, 'Welcome to AgentOS via SMS! Send "menu" to see available commands.');
  }

  async _handleMenu(phoneNumber) {
    const text = `AgentOS Menu:\ndashboard\nstats\nnetwork\nusers\nping\nhelp`;
    await this.send(phoneNumber, text);
  }

  async handleIncomingMessage(phoneNumber, text, rawData = {}) {
    const { getChatRegistry } = require('../chat-registry');
    getChatRegistry().register('sms', phoneNumber);

    const cmdName = text.trim().toLowerCase().split(/\s+/)[0];
    const handler = this.handlers?.get(cmdName);

    if (handler) {
      const args = text.trim().split(/\s+/).slice(1);
      const wrapped = this._rl(handler);
      await wrapped(phoneNumber, rawData, args);
      return;
    }

    const wrappedNL = this._rl(async (phoneNum, rawMsg) => {
      this.emit('message', {
        userId: phoneNum,
        channel: 'sms',
        channelId: phoneNum,
        text: text,
        raw: rawMsg
      });
    });
    await wrappedNL(phoneNumber, rawData);
  }

  // ── Econet A2A helpers ────────────────────────────────────────────────────

  /**
   * Fetch (or refresh) an Econet OAuth2 bearer token.
   * Token is cached until 60 s before expiry.
   */
  async _econetToken() {
    const ec = this._econet;
    if (ec.token && Date.now() < ec.tokenExpiry) return ec.token;

    const body = JSON.stringify({
      clientId: ec.clientId,
      clientSecret: ec.clientSecret,
      grantType: 'client_credentials'
    });

    const data = await this._econetRequest('POST', '/oauth/token', body, null);
    ec.token = data.access_token;
    // default TTL 3600 s; subtract 60 s safety buffer
    ec.tokenExpiry = Date.now() + ((data.expires_in || 3600) - 60) * 1000;
    return ec.token;
  }

  /**
   * Low-level Econet REST call.
   * @param {string} method   HTTP verb
   * @param {string} path     Path relative to baseUrl
   * @param {string|null} body JSON body string
   * @param {string|null} token Bearer token (null for token endpoint itself)
   */
  _econetRequest(method, path, body, token) {
    return new Promise((resolve, reject) => {
      const url = new URL(this._econet.baseUrl + path);
      const transport = url.protocol === 'https:' ? https : http;
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (body) headers['Content-Length'] = Buffer.byteLength(body);

      const req = transport.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers
      }, (res) => {
        let raw = '';
        res.on('data', d => { raw += d; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw);
            if (res.statusCode >= 400) return reject(new Error(parsed.message || raw));
            resolve(parsed);
          } catch (e) { reject(new Error(`Econet parse error: ${raw}`)); }
        });
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  /**
   * Send an SMS via Econet A2A messaging gateway.
   */
  async _sendEconet(userId, text) {
    const token = await this._econetToken();
    await this._econetRequest('POST', '/messaging/v1/sms/send', JSON.stringify({
      from: this._econet.fromName,
      to: userId,
      message: text
    }), token);
  }

  // ── Core send ──────────────────────────────────────────────────────────────

  async send(userId, message) {
    message = this.formatMessage(message);
    console.log(`[SMS to ${userId}]: ${message.text}`);

    if (this.provider === 'twilio' && this.client) {
      try {
        await this.client.messages.create({
          body: message.text,
          from: this.fromNumber,
          to: userId
        });
      } catch (err) {
        console.error(`SMSChannel[twilio] failed to send to ${userId}: ${err.message}`);
        return { success: false, error: err.message };
      }
    } else if (this.provider === 'econet' && this._econet?.clientId) {
      try {
        await this._sendEconet(userId, message.text);
      } catch (err) {
        console.error(`SMSChannel[econet] failed to send to ${userId}: ${err.message}`);
        return { success: false, error: err.message };
      }
    }

    this.messageCount++;
    return { success: true };
  }

  async broadcast(message) {
    const { getChatRegistry } = require('../chat-registry');
    const phones = getChatRegistry().getChats('sms');
    if (!phones || phones.length === 0) return { success: true, sentCount: 0 };
    
    console.log(`[SMS Broadcast] sending to ${phones.length} users.`);
    const promises = phones.map(phone => this.send(phone, message));
    const results = await Promise.allSettled(promises);
    return { 
      success: true, 
      sentCount: results.filter(r => r.status === 'fulfilled' && r.value?.success).length 
    };
  }

  getStatus() {
    return {
      ...super.getStatus(),
      provider: this.provider,
      econetConfigured: !!(this._econet?.clientId)
    };
  }
}

BaseChannel.register('sms', SMSChannel);

module.exports = SMSChannel;
