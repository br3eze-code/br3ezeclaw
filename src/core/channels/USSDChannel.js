// src/core/channels/USSDChannel.js
const { BaseChannel } = require('./BaseChannel');

class USSDChannel extends BaseChannel {
    static getMetadata() {
        return {
            name: 'USSD',
            description: 'Offline reach via GSM gateways',
            configFields: [
        {
                "name": "port",
                "type": "input",
                "message": "Modem Port:",
                "default": "/dev/ttyUSB0"
        }
]
        };
    }

  constructor(config, agent) {
    super(config, agent);
    this.provider = config.provider || 'africastalking';
    // Manage USSD sessions
    this.sessions = new Map();
    this._registerHandlers();
  }

  async initialize() {
    this.connected = true;
    console.log(`USSDChannel initialized using provider: ${this.provider}`);
  }

  _rl(fn) {
    return async (phoneNumber, msg, args, sessionId) => {
      try {
        if (!this.isAuthorized(phoneNumber)) {
          return this.send(phoneNumber, 'END Unauthorized user.', { sessionId });
        }

        const { getDatabase } = require('../database');
        const db = await getDatabase();

        await db.upsertUser(phoneNumber, {
          username: phoneNumber,
          platform: 'ussd',
          channels: { ussd: phoneNumber }
        }).catch(e => console.warn(`USSD user sync failed: ${e.message}`));

        // Resolve (or auto-provision) the caller's Firebase Auth record.
        // Build a scoped UserDoc so handlers can only read/write their own doc.
        const authUser = await db.resolveFirebaseUser(phoneNumber, {
          channel: 'ussd',
          channelId: phoneNumber
        }).catch(() => null);

        const userDoc = authUser?.uid ? db.getUserDoc(authUser.uid) : null;
        const ctx = { phoneNumber, sessionId, userDoc, uid: authUser?.uid || null, db };

        await fn.call(this, phoneNumber, msg, args, sessionId, ctx);
      } catch (err) {
        console.error(`USSDChannel handler error: ${err.message}`, { phoneNumber });
        await this.send(phoneNumber, `END Error: ${err.message}`, { sessionId }).catch(() => { });
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

  async _handleStart(phoneNumber, msg, args, sessionId) {
    await this.send(phoneNumber, 'CON Welcome to AgentOS USSD.\n1. Dashboard\n2. Stats\n3. Network\n4. Exit', { sessionId });
  }

  async _handleMenu(phoneNumber, msg, args, sessionId) {
    await this.send(phoneNumber, 'CON AgentOS Menu:\n1. Dashboard\n2. Stats\n3. Network\n4. Exit', { sessionId });
  }

  async handleIncomingUSSD(sessionId, phoneNumber, text, rawData = {}) {
    const { getChatRegistry } = require('../chat-registry');
    getChatRegistry().register('ussd', phoneNumber);

    // Track session state
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = { id: sessionId, phoneNumber, history: [] };
      this.sessions.set(sessionId, session);
    }
    session.history.push(text);

    // Basic USSD routing
    if (text === '') {
      const wrapped = this._rl(this.handlers.get('start'));
      await wrapped(phoneNumber, text, [], sessionId);
      return;
    }

    const cmdName = text.trim().toLowerCase().split(/\s+/)[0];
    const handler = this.handlers?.get(cmdName);

    if (handler) {
      const args = text.trim().split(/\s+/).slice(1);
      const wrapped = this._rl(handler);
      await wrapped(phoneNumber, text, args, sessionId);
      return;
    }

    const wrappedNL = this._rl(async (phoneNum, msgText, args, sessId) => {
      this.emit('message', {
        userId: phoneNum,
        sessionId: sessId,
        channel: 'ussd',
        channelId: phoneNum,
        text: msgText,
        raw: rawData
      });
    });
    await wrappedNL(phoneNumber, text, [], sessionId);
  }

  // Override base send to support USSD CON/END semantics while maintaining compatibility
  async send(userId, message, options = {}) {
    let sessionId = options.sessionId;
    if (!sessionId) {
      for (const [sid, sess] of this.sessions.entries()) {
        if (sess.phoneNumber === userId) {
          sessionId = sid;
          break;
        }
      }
    }
    sessionId = sessionId || 'default_session';

    let text = message;
    if (typeof message === 'object') {
      text = message.text;
    }

    // Ensure USSD format (CON for continue, END for terminate)
    if (!text.startsWith('CON ') && !text.startsWith('END ')) {
      text = 'CON ' + text;
    }

    if (text.startsWith('END ')) {
      this.sessions.delete(sessionId);
    }

    console.log(`[USSD to ${userId} (Session: ${sessionId})]: ${text}`);
    this.messageCount++;
    return { success: true, text };
  }

  // Support typical BaseChannel send
  async sendBase(userId, message) {
    return this.send('default_session', userId, message);
  }

  async broadcast(message) {
    console.log(`[USSD Broadcast NOT SUPPORTED]: ${message}`);
    return Promise.allSettled([]);
  }

  getStatus() {
    return {
      ...super.getStatus(),
      provider: this.provider,
      activeSessions: this.sessions.size
    };
  }
}

BaseChannel.register('ussd', USSDChannel);

module.exports = USSDChannel;
