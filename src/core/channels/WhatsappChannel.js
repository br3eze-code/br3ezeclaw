// NOTE: @whiskeysockets/baileys is ESM-only — must be loaded via dynamic import()
// inside initialize(), never at the top level via require().
const path = require('path');
const fs = require('fs');
const _chalk = require('chalk');
const chalk = _chalk.default || _chalk;
const { logger } = require('../logger');
const { BaseChannel } = require('./BaseChannel');

class WhatsAppChannel extends BaseChannel {
  static getMetadata() {
    return {
      name: 'WhatsApp',
      description: 'Native WhatsApp integration via Baileys',
      configFields: [
        {
          "name": "authStateFolder",
          "type": "input",
          "message": "Auth State Folder:",
          "default": "./data/whatsapp_auth"
        }
      ]
    };
  }

  async validateConfig() {
    const waAuthDir = this.config.authStateFolder || './data/whatsapp_auth';
    if (!fs.existsSync(waAuthDir)) {
      return { valid: false, error: 'Missing auth data folder' };
    }
    return { valid: true, error: null };
  }

  constructor(config, agent) {
    super(config, agent);
    this.sock = null;
    this.qrCode = null;
    this.authStateFolder = config.authStateFolder || path.join(process.cwd(), 'data', 'whatsapp_auth');
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.allowedJids = new Set();
    const rawAllowed = config.allowed_ids || config.allowedJids || [];
    rawAllowed.forEach(id => {
      const normalized = this.normalizeJid(id);
      if (normalized) this.allowedJids.add(normalized);
    });

    // Patterns from TelegramChannel
    this.rateLimiter = new Map();
    this.pendingInputs = new Map(); // jid -> { action, data }
    this.messageCache = new Map();
    this._alertState = new Map();

    // Command registry
    this.handlers = new Map();
    this._registerHandlers();
    this._handlersRegistered = true;
  }

  /**
   * Normalize JID format
   */
  normalizeJid(jid) {
    if (!jid) return null;
    const parts = jid.split('@');
    const number = parts[0].replace(/[^0-9]/g, '');
    const domain = parts[1] || 's.whatsapp.net';

    if (domain === 'g.us') return `${number}@g.us`;
    if (domain === 'lid') return `${number}@lid`;
    return `${number}@s.whatsapp.net`;
  }

  /**
   * Check if JID is authorized
   */
  isAuthorized(jid) {
    if (!jid) return false;
    const normalized = this.normalizeJid(jid);
    const allowed = this.config.allowed_ids || [];

    // Filter for WhatsApp-specific allowed IDs (those containing '@')
    const whatsappAllowed = allowed.filter(id => String(id).includes('@'));

    if (whatsappAllowed.length > 0) {
      const number = normalized.split('@')[0];
      // Check for full JID or just the number part (if the allowed list had numbers with @ but without domain)
      return whatsappAllowed.includes(normalized) ||
        whatsappAllowed.some(id => id.startsWith(number + '@'));
    }

    // Fallback to legacy allowedJids Set if no @ IDs found in allowed_ids
    if (this.allowedJids.size > 0) {
      return this.allowedJids.has(normalized);
    }

    // If allowed_ids has values but none for WhatsApp, we default to restricted (return false)
    // UNLESS the entire system is open.
    if (allowed.length > 0 && whatsappAllowed.length === 0) {
      return false;
    }

    return true; // Default to open if no restrictions at all
  }

  async initialize() {
    if (!this.config.enabled && this.config.enabled !== undefined) {
      logger.info('WhatsApp channel disabled');
      return;
    }

    // 1. Verify AuthState Integrity
    const credsFile = path.join(this.authStateFolder, 'creds.json');
    if (fs.existsSync(credsFile)) {
      try {
        JSON.parse(fs.readFileSync(credsFile, 'utf8'));
      } catch (e) {
        logger.error('WhatsApp creds.json is corrupt. Resetting session.');
        fs.renameSync(credsFile, `${credsFile}.bak-${Date.now()}`);
      }
    }

    try {
      // Dynamic import required: @whiskeysockets/baileys is ESM-only
      const baileysModule = await import('@whiskeysockets/baileys');
      const makeWASocket = baileysModule.default;
      const { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = baileysModule;

      const { state, saveCreds } = await useMultiFileAuthState(this.authStateFolder);

      // 2. Fetch version with timeout fallback
      let version;
      let isLatest = false;
      try {
        const v = await fetchLatestBaileysVersion();
        version = v.version;
        isLatest = v.isLatest;
      } catch (e) {
        logger.warn('Failed to fetch Baileys version, using fallback [2, 3000, 101594821]');
        version = [2, 3000, 101594821];
      }

      logger.info(`Initializing WhatsApp with Baileys v${version.join('.')} (isLatest: ${isLatest})`);

      // Adapter for Baileys (pino) logger to AgentOS (winston) logger
      const createBaileysLogger = (parent) => {
        const isDebug = process.env.LOG_LEVEL === 'debug' || process.env.DEBUG?.includes('whatsapp') || process.env.WHATSAPP_DEBUG === 'true';
        return {
          level: isDebug ? 'debug' : 'warn',
          child: (bindings) => createBaileysLogger(parent.child(bindings)),
          trace: (obj, msg) => { if (isDebug) typeof obj === 'string' ? parent.debug(obj) : parent.debug(msg || '', obj); },
          debug: (obj, msg) => { if (isDebug) typeof obj === 'string' ? parent.debug(obj) : parent.debug(msg || '', obj); },
          info: (obj, msg) => { if (isDebug) typeof obj === 'string' ? parent.info(obj) : parent.info(msg || '', obj); },
          warn: (obj, msg) => typeof obj === 'string' ? parent.warn(obj) : parent.warn(msg || '', obj),
          error: (obj, msg) => typeof obj === 'string' ? parent.error(obj) : parent.error(msg || '', obj),
          fatal: (obj, msg) => typeof obj === 'string' ? parent.error(obj) : parent.error(msg || '', obj),
        };
      };

      this.sock = makeWASocket({
        version,
        auth: state,
        browser: ['AgentOS', 'Desktop', '1.0'],
        logger: createBaileysLogger(logger.child({ service: 'whatsapp-channel' })),
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: true,
        printQRInTerminal: false
      });

      // Store disconnect reason reference for the event handler
      this._DisconnectReason = DisconnectReason;

      this.sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCode = qr;
          this.emit('qr', qr);

          const qrcode = require('qrcode-terminal');

          if (global.startupSpinner && global.startupSpinner.isSpinning) {
            // Temporarily stop spinner to show QR cleanly
            global.startupSpinner.stop();
            console.log('\n📱 ' + chalk.cyan('WhatsApp Login Required'));
            console.log(chalk.gray('Scan the code below to connect your account:\n'));
            qrcode.generate(qr, { small: true });
            console.log(''); // spacer
            global.startupSpinner.start();
          } else {
            logger.info('WhatsApp QR code generated');
            qrcode.generate(qr, { small: true });
          }
        }

        if (connection === 'close') {
          const code = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = code !== this._DisconnectReason?.loggedOut;

          logger.info(`WhatsApp connection closed (code: ${code}). Reconnecting: ${shouldReconnect}`);
          this.connected = false;
          this.qrCode = null;
          this.emit('status', 'disconnected');

          if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const delay = Math.min(this.reconnectAttempts * 5000, 30000);
            logger.info(`Scheduling WhatsApp reconnect (attempt ${this.reconnectAttempts}) in ${delay / 1000}s...`);
            setTimeout(() => this.initialize(), delay);
          } else if (!shouldReconnect) {
            logger.info('WhatsApp logged out. Please pair again.');
            this.emit('logout');
          } else {
            logger.error('WhatsApp max reconnect attempts reached. Manual intervention required.');
          }
        } else if (connection === 'open') {
          this.connected = true;
          this.qrCode = null;
          this.reconnectAttempts = 0;
          this.emit('connected');
          this.emit('status', 'connected');
          logger.info('WhatsApp connected successfully');
        }
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('messages.upsert', async (m) => {
        try {
          if (m.type !== 'notify') return;

          for (const msg of m.messages) {
            // Ignore messages from self and those without a message body
            if (msg.key.fromMe || !msg.message) continue;

            // Deduplicate (Baileys sometimes sends same message twice)
            const msgId = msg.key.id;
            if (this.messageCache.has(msgId)) continue;
            this.messageCache.set(msgId, Date.now());

            await this.handleIncomingMessage(msg);
          }
        } catch (error) {
          logger.error('WhatsApp message upsert handling error:', error);
        }
      });

      // Periodic cache cleanup
      this.cacheCleanup = setInterval(() => {
        const now = Date.now();
        for (const [id, time] of this.messageCache.entries()) {
          if (now - time > 300000) this.messageCache.delete(id);
        }
      }, 60000);

    } catch (error) {
      this.errorCount++;
      logger.error('WhatsApp initialization error:', error);
      throw error;
    }
  }

  // ── Rate limiting & Middleware ─────────────────────────────────────────────

  _checkRateLimit(jid) {
    const now = Date.now();
    const key = jid.toString();
    const limit = 30;

    if (!this.rateLimiter.has(key)) {
      this.rateLimiter.set(key, { count: 1, resetTime: now + 60_000 });
      return { allowed: true, remaining: limit - 1, resetTime: now + 60_000 };
    }

    const slot = this.rateLimiter.get(key);
    if (now > slot.resetTime) {
      slot.count = 1;
      slot.resetTime = now + 60_000;
      return { allowed: true, remaining: limit - 1, resetTime: slot.resetTime };
    }

    if (slot.count >= limit) {
      return { allowed: false, remaining: 0, resetTime: slot.resetTime };
    }

    slot.count++;
    return { allowed: true, remaining: limit - slot.count, resetTime: slot.resetTime };
  }

  /**
   * Rate Limit & Auth Wrapper (similar to Telegram's _rl)
   */
  _rl(fn) {
    return async (jid, msg, match) => {
      if (!this.isAuthorized(jid)) {
        logger.warn(`Unauthorized WhatsApp access attempt from ${jid}`);
        return;
      }

      const rlStatus = this._checkRateLimit(jid);
      if (!rlStatus.allowed) {
        const seconds = Math.ceil((rlStatus.resetTime - Date.now()) / 1000);
        return this.send(jid, `⏳ *Rate limit* — please slow down. 0 mistakes available. Reset in ${seconds}s.`);
      }

      // Inject rate limit info into the message object for the handler to use if needed
      msg._rl = rlStatus;

      try {
        // ── Auto-register/Sync User ──────────────────────────────────
        const { getDatabase } = require('../database');
        const db = await getDatabase();

        const pushName = msg.pushName || '';
        const number = jid.split('@')[0];

        await db.upsertUser(jid, {
          username: pushName || number,
          firstName: pushName,
          platform: 'whatsapp',
          channels: { whatsapp: jid },
        }).catch(e => logger.warn(`WhatsApp user sync failed: ${e.message}`));

        // Bridge to Firebase Auth if possible
        db.resolveFirebaseUser(jid, {
          channel: 'whatsapp',
          channelId: jid,
        }).catch(() => { });

        await fn.call(this, jid, msg, match);
      } catch (err) {
        logger.error(`WhatsAppChannel handler error: ${err.message}`, { jid });
        await this.send(jid, `❌ *Error:* ${err.message}`).catch(() => { });
      }
    };
  }

  _registerHandlers() {
    this.handlers.set('start', this._handleStart);
    this.handlers.set('menu', this._handleMenu);
    this.handlers.set('help', this._handleHelp);
    this.handlers.set('dashboard', this._handleDashboard);
    this.handlers.set('voucher', this._handleVoucher);
    this.handlers.set('users', this._handleUsers);
    this.handlers.set('stats', this._handleStats);
    this.handlers.set('kick', this._handleKick);
    this.handlers.set('reboot', this._handleReboot);
    this.handlers.set('dahua', this._handleDahua);
    this.handlers.set('ping', this._handlePing);
    this.handlers.set('ask', this._handleAsk);
    this.handlers.set('cli', this._handleCli);
    this.handlers.set('api', this._handleApi);
    this.handlers.set('wallet', this._handleWallet);
    this.handlers.set('pay', this._handlePay);
    this.handlers.set('claim', this._handleClaim);
    this.handlers.set('token', this._handleToken);
    this.handlers.set('tools', this._handleTools);
    this.handlers.set('tool', this._handleTool);
    this.handlers.set('setup_router', this._handleSetupRouter);
    this.handlers.set('network', this._handleNetwork);
    this.handlers.set('neighbors', this._handleNeighbors);
    this.handlers.set('dns', this._handleDns);
    this.handlers.set('status', this._handleStatus);
    this.handlers.set('bulk', this._handleBulkVoucher);
    this.handlers.set('mistakes', this._handleMistakes);
  }

  async handleIncomingMessage(message) {
    this.messageCount++;
    const from = message.key.remoteJid;

    // Extract text from various message types
    const text = message.message?.conversation ||
      message.message?.extendedTextMessage?.text ||
      message.message?.imageMessage?.caption ||
      message.message?.videoMessage?.caption ||
      message.message?.buttonsResponseMessage?.selectedButtonId ||
      message.message?.listResponseMessage?.singleSelectReply?.selectedRowId || '';

    // Register active chat for broadcasts
    const { getChatRegistry } = require('../chat-registry');
    getChatRegistry().register('whatsapp', from);

    // Command Dispatcher
    if (text.startsWith('/')) {
      const args = text.slice(1).trim().split(/\s+/);
      const cmdName = args[0].toLowerCase();
      const handler = this.handlers.get(cmdName);

      if (handler) {
        const wrapped = this._rl(handler);
        await wrapped(from, message, args);
        return;
      }
    }

    // Pending Inputs (Prompts)
    const pending = this.pendingInputs.get(from);
    if (pending && text.trim()) {
      this.pendingInputs.delete(from);
      const wrapped = this._rl(this._executePending);
      await wrapped(from, message, { text: text.trim(), action: pending.action, data: pending.data });
      return;
    }

    // Natural Language / Default Emit
    if (text.trim()) {
      // ── Email Identity Capture ──────────────────────────────────────────
      const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi;
      const emails = text.match(emailRegex);
      if (emails && emails.length > 0) {
        const email = emails[0].toLowerCase();
        const { getDatabase } = require('../database');
        const db = await getDatabase();

        await db.upsertUser(from, {
          email,
          platform: 'whatsapp',
          lastSeen: new Date().toISOString()
        }).catch(e => logger.warn(`[WhatsApp] Email capture sync failed: ${e.message}`));

        logger.info(`[WhatsApp] Captured email ${email} from ${from}`);
      }

      const wrappedNL = this._rl(async (userId, rawMsg) => {
        this.emit('message', {
          text: text.trim(),
          userId: userId,
          sender: rawMsg.pushName || userId.split('@')[0],
          channel: 'whatsapp',
          raw: rawMsg
        });
      });
      await wrappedNL(from, message);
    }
  }

  /**
   * Set a pending input for a user (interactive prompt)
   */
  promptUser(jid, text, action, data = {}) {
    this.pendingInputs.set(jid, { action, data });
    return this.send(jid, text);
  }

  // ── Handlers ───────────────────────────────────────────────────────────────
  async _handleStart(jid, msg) {
    const pushName = msg.pushName || 'there';
    const text = `🤖 *AgentOS WhatsApp*\n\nWelcome, ${pushName}! I'm your network intelligence assistant.\n\nUse */menu* to see available commands or just ask me anything!`;
    await this.send(jid, text);
  }

  async _handleMistakes(jid, msg) {
    const rl = msg._rl || this._checkRateLimit(jid);
    const seconds = Math.ceil((rl.resetTime - Date.now()) / 1000);
    const text = `🛡 *Quota Status*\nYou have *${rl.remaining} mistakes* (actions) available in this window.\nReset in ${seconds}s.`;
    await this.send(jid, text);
  }

  async _handleMenu(jid) {
    const text = `🤖 *AgentOS Commands*\n\n` +
      `*/start* — Welcome message\n` +
      `*/dashboard* — System overview\n` +
      `*/users* — Active sessions\n` +
      `*/stats* — Router stats\n` +
      `*/voucher [plan]* — Create voucher\n` +
      `*/wallet* — Check balance\n` +
      `*/pay* — Recharge account\n` +
      `*/kick <user>* — Disconnect user\n` +
      `*/reboot* — Router reboot\n` +
      `*/ping <host>* — Network test\n` +
      `*/ask <query>* — AI assistant\n` +
      `*/help* — This message`;
    await this.send(jid, text);
  }

  async _handleHelp(jid) {
    await this._handleMenu(jid);
  }

  async _handleDashboard(jid, msg, opts = {}) {
    const context = { userId: jid, channel: 'whatsapp' };
    const { getDatabase } = require('../database');
    const db = await getDatabase();
    const mt = this.agent?.mikrotik || global.mikrotik;

    try {
      let resource = null;
      let activeUsers = [];
      try {
        resource = await mt.executeTool('system.stats', {}, context);
      } catch (err) {
        logger.warn(`WhatsApp Dashboard: Could not fetch resource: ${err.message}`);
      }

      try {
        activeUsers = await mt.executeTool('users.active', {}, context);
      } catch (err) {
        logger.warn(`WhatsApp Dashboard: Could not fetch active users: ${err.message}`);
      }

      const revenue = await db.getRevenue?.('daily').catch(() => ({ total: 0, count: 0 })) || { total: 0, count: 0 };
      const wallet = await db.getWallet(jid).catch(() => ({ balance: 0, currency: 'USD' }));

      const cpu = parseInt(resource?.['cpu-load'] || 0);
      const memTotal = parseInt(resource?.['total-memory'] || 0);
      const memFree = parseInt(resource?.['free-memory'] || 0);
      const memUsedPercent = memTotal > 0 ? Math.round(((memTotal - memFree) / memTotal) * 100) : 0;

      const cpuEmoji = Number(cpu) > 80 ? '🔴' : Number(cpu) > 50 ? '🟡' : '🟢';
      const memEmoji = memUsedPercent > 80 ? '🔴' : memUsedPercent > 50 ? '🟡' : '🟢';

      const routerStatus = resource ?
        `🖥️ *Router Status*\n` +
        `${cpuEmoji} CPU: *${cpu}%*\n` +
        `${memEmoji} RAM: *${memUsedPercent}%* used\n` +
        `⏱ Uptime: \`${resource?.uptime || 'N/A'}\`\n` +
        `📦 OS: \`${resource?.version || 'N/A'}\`\n\n` :
        `🖥️ *Router Status*: 🔴 Offline\n\n`;

      const walletLine = `💳 Balance: *${(wallet.balance || 0).toFixed(2)} ${wallet.currency || 'USD'}*\n`;

      const text = `📊 *AgentOS Dashboard*\n\n` +
        routerStatus +
        `🌐 *Network*\n` +
        `🟢 Active Users: *${activeUsers?.length || 0}*\n\n` +
        `💰 *Finance (Today)*\n` +
        `💵 Revenue: *${revenue.total ? revenue.total.toFixed(2) : '0.00'} USD*\n` +
        `🎫 Sales: *${revenue.count || 0}* vouchers\n` +
        walletLine + `\n` +
        (resource ? `✅ System healthy` : `⚠️ Router offline`);

      await this.send(jid, text);
    } catch (err) {
      logger.error('WhatsAppChannel Dashboard error:', err);
      await this.send(jid, `❌ Dashboard error: ${err.message}`);
    }
  }

  async _handleUsers(jid) {
    const context = { userId: jid, channel: 'whatsapp' };
    const users = await this.agent.executeTool('users.active', {}, context);
    if (!users?.length) {
      await this.send(jid, '👥 No active users found.');
    } else {
      let msg = `👥 *Active Users (${users.length})*\n\n`;
      users.slice(0, 15).forEach((u, i) => {
        msg += `${i + 1}. *${u.user || u.name}* (${u.address})\n   ⏱ ${u.uptime}\n`;
      });
      if (users.length > 15) msg += `\n_...and ${users.length - 15} more_`;
      await this.send(jid, msg);
    }
  }

  async _handleVoucher(jid, msg, args) {
    const planId = args[1];
    const { getDatabase } = require('../database');
    const db = await getDatabase();

    const user = await db.getUser(jid);
    const isAdmin = user?.role === 'admin' || user?.role === 'reseller';

    // If a planId was provided directly
    if (planId) {
      return this._createVoucher(jid, planId);
    }

    // List plans dynamically
    try {
      let plans = await db.getPlans(true);
      if (!plans.length) {
        const { getConfig } = require('../config');
        const cfg = getConfig();
        plans = Array.isArray(cfg.plans) ? cfg.plans.filter(p => p.active !== false) : [];
      }

      if (!plans.length) {
        plans = [
          { id: '1Hour', name: '1 Hour', price: 0.5 },
          { id: '1Day', name: '1 Day', price: 1.0 },
          { id: '7Day', name: '7 Days', price: 3.0 }
        ];
      }

      const wallet = await db.getWallet(jid);
      const balance = wallet.balance || 0;
      const currency = wallet.currency || 'USD';

      let msgText = `🎫 *Create Voucher*\n\n` +
        `Role: *${isAdmin ? 'Admin (Free)' : 'User'}*\n` +
        `Balance: *${balance} ${currency}*\n\n` +
        `Available Plans:\n`;

      plans.forEach(p => {
        msgText += `- */voucher ${p.id || p.mikrotikProfile}* (${p.name}: ${p.price} ${currency})\n`;
      });

      msgText += `\n_Type the command for the plan you want._`;
      await this.send(jid, msgText);
    } catch (err) {
      await this.send(jid, `❌ Failed to list plans: ${err.message}`);
    }
  }

  /**
   * Core voucher creation logic (ported/enhanced from Telegram)
   */
  async _createVoucher(jid, planId) {
    const { getDatabase } = require('../database');
    const db = await getDatabase();
    const user = await db.getUser(jid);
    const isAdmin = user?.role === 'admin' || user?.role === 'reseller';

    const planObj = await db.getPlan(planId) || { name: 'Custom', deviceLimit: 1, durationUnit: 'days', durationValue: 1 };
    const price = planObj.price || 0;

    if (!isAdmin) {
      const wallet = await db.getWallet(jid);
      if ((wallet.balance || 0) < price) {
        return this.send(jid, `❌ *Insufficient Balance*\nPlan requires ${price} but you only have ${wallet.balance || 0}. Use */pay* to top up.`);
      }
      // Deduct balance
      await db.updateWallet(jid, { balance: (wallet.balance || 0) - price });
    }

    await this.send(jid, `🎫 Generating *${planObj.name || planId}* voucher...`);

    const voucherAgent = require('../voucher');
    const code = voucherAgent.generate(planId);

    const mt = this.agent?.mikrotik || global.mikrotik;
    const dateUtils = require('../../utils/date');
    const expiresAt = planObj.durationValue && planObj.durationUnit ?
      dateUtils.add(new Date(), planObj.durationValue, planObj.durationUnit).toISOString() : null;
    const loginUrl = `http://${mt?.state?.host || 'hotspot.local'}/login?username=${code}&password=${code}`;

    await db.createVoucher(code, {
      plan: planId,
      planName: planObj.name || planId,
      durationUnit: planObj.durationUnit || null,
      durationValue: planObj.durationValue || null,
      deviceLimit: planObj.deviceLimit || 1,
      expiresAt,
      loginUrl,
      userId: jid,
      createdBy: 'whatsapp',
      value: price,
      currency: user?.currency || 'USD'
    });

    // Update user subscription record (matching Telegram)
    try {
      await db.updateSubscription(jid, {
        planId,
        planName: planObj.name || planId,
        purchasedAt: new Date().toISOString(),
        expiresAt,
      });
    } catch (subErr) {
      logger.warn(`WhatsApp subscription update failed: ${subErr.message}`);
    }

    if (mt) {
      const _durationToMikrotik = (p) => {
        if (!p || !p.durationValue || !p.durationUnit) return null;
        const v = p.durationValue;
        switch (p.durationUnit) {
          case 'weeks': return `${v}w`;
          case 'days': return `${v}d`;
          case 'hours': return `${String(v).padStart(2, '0')}:00:00`;
          case 'minutes': return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}:00`;
          default: return null;
        }
      };

      await mt.addHotspotUser({
        username: code, password: code, profile: planId,
        sharedUsers: planObj.deviceLimit || 1,
        ...(expiresAt && { limitUptime: _durationToMikrotik(planObj) })
      }).catch(e => logger.error(`WhatsApp Mikrotik Sync Failed: ${e.message}`));
    }

    // Generate QR
    const QRCode = require('qrcode');
    const qrBuf = await QRCode.toBuffer(loginUrl);

    await this.sendMedia(jid, qrBuf, 'image/png',
      `🎫 *Voucher Created*\n\n` +
      `Code: \`${code}\`\n` +
      `Plan: *${planObj.name || planId}*\n` +
      `Expires: ${expiresAt ? new Date(expiresAt).toLocaleString() : 'Never'}\n\n` +
      `_Scan the code or login manually at the portal._`
    );

    // Trigger printing if thermal printer is configured
    try {
      const { printVoucher } = require('../printer');
      await printVoucher({
        username: code,
        password: code,
        profile: planObj.name || planId,
        loginUrl: loginUrl
      });
    } catch (e) {
      // Silent fail for printer
    }
  }

  async _handleStats(jid) {
    const mt = this.agent?.mikrotik || global.mikrotik;
    if (!mt) return this.send(jid, '⚠️ MikroTik not connected.');

    try {
      const stats = await mt.executeTool('system.stats');
      const health = mt.state?.lastKnownHealth || {};

      const text = `📊 *Router Statistics*\n\n` +
        `Board: *${stats.board || 'MikroTik'}*\n` +
        `Model: \`${stats.model || 'N/A'}\`\n` +
        `Version: \`${stats.version || 'N/A'}\`\n` +
        `CPU: \`${stats['cpu-load']}%\` (${stats.cpu || 'N/A'})\n` +
        `RAM: \`${stats['free-memory']} / ${stats['total-memory']}\`\n` +
        `Disk: \`${stats['free-hdd-space']} / ${stats['total-hdd-space']}\`\n` +
        `Uptime: \`${stats.uptime}\`\n\n` +
        `⚡ Voltage: \`${health.voltage || 'N/A'}V\`\n` +
        `🌡 Temp: \`${health.temperature || 'N/A'}C\``;

      await this.send(jid, text);
    } catch (err) {
      await this.send(jid, `❌ Stats Error: ${err.message}`);
    }
  }

  async _handleKick(jid, msg, args) {
    const target = args[1];
    if (!target) return this.send(jid, '❌ Usage: */kick <username>*');

    const context = { userId: jid, channel: 'whatsapp' };
    await this.agent.executeTool('user.kick', { target }, context);
    await this.send(jid, `✅ User *${target}* kicked successfully.`);
  }

  async _handleReboot(jid) {
    this.pendingInputs.set(jid, { action: 'confirm_reboot' });
    await this.send(jid, '⚠️ *Confirm System Reboot?*\nAll users will be disconnected. Reply with "yes" to confirm.');
  }

  async _handlePing(jid, msg, args) {
    const host = args[1];
    if (!host) {
      this.pendingInputs.set(jid, { action: 'ping' });
      return this.send(jid, '📡 *Ping*\nPlease enter the target IP or host:');
    }

    const mt = this.agent?.mikrotik;
    if (!mt) return this.send(jid, '⚠️ MikroTik not connected.');

    await this.send(jid, `📡 Pinging ${host}...`);
    try {
      const result = await mt.executeTool('ping', { host, count: 4 });
      await this.send(jid, `✅ *Ping ${host}*\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``);
    } catch (err) {
      await this.send(jid, `❌ Ping failed: ${err.message}`);
    }
  }

  async _handleDahua(jid, msg, args) {
    const action = args[1] || 'list';
    const device = args[2];
    const context = { userId: jid, channel: 'whatsapp' };

    if (action === 'list') {
      const result = await this.agent.executeTool('dahua.device.list', {}, context);
      const response = result.map(d => `- *${d.name}* (${d.id}): ${d.host}`).join('\n');
      await this.send(jid, `✅ *Dahua Devices*\n\n${response || 'No devices found.'}`);
    } else if (action === 'snapshot') {
      const result = await this.agent.executeTool('dahua.snapshot.get', { device }, context);
      if (result.base64) {
        const imgBuffer = Buffer.from(result.base64, 'base64');
        await this.sendMedia(jid, imgBuffer, 'image/jpeg', `📷 Snapshot: ${device || 'Default'}`);
      } else {
        await this.send(jid, `❌ Snapshot failed.`);
      }
    }
  }

  async _handleAsk(jid, msg, args) {
    const query = args.slice(1).join(' ');
    if (!query) return this.send(jid, '❌ Usage: */ask <your question>*');

    // Pass to AI via emit
    this.emit('message', {
      text: query,
      userId: jid,
      sender: msg.pushName || jid.split('@')[0],
      channel: 'whatsapp',
      raw: msg
    });
  }

  async _handleCli(jid, msg, args) {
    const cmd = args.slice(1).join(' ');
    if (!cmd) return this.send(jid, '❌ Usage: */cli <command>*');

    const mt = this.agent?.mikrotik;
    if (!mt) return this.send(jid, '⚠️ MikroTik not connected.');

    try {
      const res = await mt.executeCLI(cmd);
      await this.send(jid, `💻 *CLI:*\n\`\`\`text\n${res}\n\`\`\``);
    } catch (err) {
      await this.send(jid, `❌ CLI Error: ${err.message}`);
    }
  }

  async _handleApi(jid, msg, args) {
    const cmd = args.slice(1).join(' ');
    if (!cmd) return this.send(jid, '❌ Usage: */api <path>*');

    const mt = this.agent?.mikrotik;
    if (!mt) return this.send(jid, '⚠️ MikroTik not connected.');

    try {
      const res = await mt.executeRawAPI(cmd);
      await this.send(jid, `⚙️ *API:*\n\`\`\`json\n${JSON.stringify(res, null, 2)}\n\`\`\``);
    } catch (err) {
      await this.send(jid, `❌ API Error: ${err.message}`);
    }
  }

  async _handleWallet(jid) {
    const { getDatabase } = require('../database');
    const db = await getDatabase();
    const wallet = await db.getWallet(jid);
    const balance = wallet.balance || 0;
    const currency = wallet.currency || 'USD';

    await this.send(jid,
      `👛 *My Wallet*\n\n` +
      `Balance: *${balance} ${currency}*\n` +
      `Status: ✅ Active\n\n` +
      `_Use */pay* to top up your balance instantly via various payment methods._`
    );
  }

  async _handlePay(jid) {
    await this.send(jid,
      `💳 *Recharge Account*\n\n` +
      `1. *M-PESA / Mobile Money*\n` +
      `2. *Credit/Debit Card*\n` +
      `3. *Cash at Counter*\n\n` +
      `_Please enter the amount you wish to top up or visit our web portal for automated payments._`
    );
  }

  async _handleClaim(jid) {
    const { getDatabase } = require('../database');
    const db = await getDatabase();
    const user = await db.getUser(jid);

    if (this.config.allowed_ids && this.config.allowed_ids.length > 0) {
      return this.send(jid, '❌ *Access Denied:* Admin has already been claimed.');
    }

    this.config.allowed_ids = [jid];
    logger.info(`WhatsAppChannel: JID ${jid} claimed primary admin status.`);

    await this.send(jid,
      `🎉 *Success!* You are now the primary admin (\`${jid}\`).\n\n` +
      `Commands are now strictly restricted to you and authorized personnel.\n` +
      `_Note: Ensure you update your configuration to persist this change._`
    );
  }

  async _handleToken(jid) {
    const token = process.env.GATEWAY_TOKEN || 'Not configured';
    await this.send(jid,
      `🔑 *System Access Token*\n\n` +
      `Token: \`${token}\`\n\n` +
      `_Use this for API and WebSocket authentication. Do not share this with anyone!_`
    );
  }

  async _handleTools(jid) {
    const mt = this.agent?.mikrotik || global.mikrotik;
    if (!mt) return this.send(jid, '⚠️ MikroTik not connected.');

    try {
      const tools = await mt.getAvailableTools();
      let msg = `🛠 *Network Tools*\n\n`;
      tools.forEach(t => {
        msg += `- */tool ${t}*\n`;
      });
      msg += `\n_Example: /tool ping 8.8.8.8_`;
      await this.send(jid, msg);
    } catch (err) {
      await this.send(jid, `❌ Failed to list tools: ${err.message}`);
    }
  }

  async _handleTool(jid, msg, args) {
    const toolName = args[1];
    if (!toolName) return this._handleTools(jid);

    const mt = this.agent?.mikrotik || global.mikrotik;
    if (!mt) return this.send(jid, '⚠️ MikroTik not connected.');

    // Simple implementation for common tools
    if (toolName === 'ping') {
      return this._handlePing(jid, msg, args);
    }

    await this.send(jid, `🔧 Tool *${toolName}* is not yet fully optimized for interactive WhatsApp mode. Please use the CLI bridge for raw execution.`);
  }

  async _handleSetupRouter(jid) {
    await this.send(jid, `🌐 *Router Onboarding*\n\nThis feature guides you through connecting a new MikroTik router to AgentOS. Please visit the web dashboard for the full visual wizard.`);
  }

  async _handleNetwork(jid) {
    const mt = this.agent?.mikrotik || global.mikrotik;
    if (!mt) return this.send(jid, '⚠️ MikroTik not connected.');

    try {
      const interfaces = await mt.getInterfaces?.() || [];
      let msg = `🌐 *Network Interfaces*\n\n`;
      interfaces.forEach(i => {
        const state = i.running === 'true' ? '✅' : '❌';
        msg += `${state} *${i.name}* (${i.type})\n   Tx: ${i['tx-byte']} | Rx: ${i['rx-byte']}\n`;
      });
      if (!interfaces.length) msg += '_No interfaces found_';
      await this.send(jid, msg);
    } catch (err) {
      await this.send(jid, `❌ Network error: ${err.message}`);
    }
  }

  async _handleStatus(jid) {
    const status = this.getStatus();
    const text = `🤖 *System Status*\n\n` +
      `Platform: *AgentOS WhatsApp*\n` +
      `Status: ${status.connected ? '✅ Connected' : '❌ Disconnected'}\n` +
      `Messages: \`${status.messageCount}\`\n` +
      `Errors: \`${status.errorCount}\`\n` +
      `Uptime: \`${Math.floor(process.uptime() / 60)}m\`\n\n` +
      `_Connected as: ${this.sock?.user?.id || 'Unknown'}_`;
    await this.send(jid, text);
  }

  async _executePending(jid, msg, { text, action, data }) {
    if (action === 'confirm_reboot') {
      if (text.toLowerCase() === 'yes') {
        await this.send(jid, '⚡ *Rebooting router...*');
        const context = { userId: jid, channel: 'whatsapp' };
        await this.agent.executeTool('system.reboot', { confirm: true }, context);
      } else {
        await this.send(jid, '❌ Reboot cancelled.');
      }
    } else if (action === 'ping') {
      await this._handlePing(jid, msg, ['', text]);
    } else if (action.startsWith('tool:')) {
      const toolName = action.split(':')[1];
      await this._handleTool(jid, msg, [null, toolName, text]);
    }
  }

  /**
   * Alert once pattern for system notifications
   */
  async alertOnce(alertKey, message) {
    const lastSent = this._alertState.get(alertKey);
    const now = Date.now();
    // Send alert if not sent before, or if more than 2 hours have passed
    if (!lastSent || now - lastSent > 2 * 60 * 60 * 1000) {
      this._alertState.set(alertKey, now);
      return this.broadcast(message);
    }
    return { success: true, skipped: true };
  }

  async send(userId, message) {
    if (!this.sock || !this.connected) {
      throw new Error('WhatsApp not connected');
    }

    const jid = this.normalizeJid(userId);
    const content = typeof message === 'string' ? { text: message } : message;

    try {
      return await this.sock.sendMessage(jid, content);
    } catch (error) {
      this.errorCount++;
      logger.error(`Failed to send WhatsApp message to ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Send media message
   */
  async sendMedia(userId, buffer, mimeType, caption = '') {
    if (!this.sock || !this.connected) {
      throw new Error('WhatsApp not connected');
    }

    const jid = this.normalizeJid(userId);
    let messageContent = {};

    if (mimeType.startsWith('image/')) {
      messageContent = { image: buffer, caption };
    } else if (mimeType.startsWith('video/')) {
      messageContent = { video: buffer, caption };
    } else if (mimeType.startsWith('audio/')) {
      messageContent = { audio: buffer, mimetype: mimeType };
    } else {
      messageContent = { document: buffer, caption, mimetype: mimeType };
    }

    try {
      return await this.sock.sendMessage(jid, messageContent);
    } catch (error) {
      this.errorCount++;
      logger.error(`Failed to send WhatsApp media to ${userId}:`, error);
      throw error;
    }
  }

  async broadcast(message) {
    const { getChatRegistry } = require('../chat-registry');
    const chats = getChatRegistry().getChats('whatsapp');
    const content = typeof message === 'string' ? { text: message } : message;

    logger.info(`WhatsAppChannel: broadcasting to ${chats.length} chats`);
    for (const jid of chats) {
      if (this.sock && this.connected) {
        this.sock.sendMessage(jid, content).catch(err => {
          logger.error(`WhatsApp broadcast failed for ${jid}: ${err.message}`);
        });
      }
    }
  }

  getStatus() {
    return {
      ...super.getStatus(),
      type: 'whatsapp',
      hasQR: !!this.qrCode,
      authorizedJids: Array.from(this.allowedJids)
    };
  }

  async destroy() {
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch (e) {
        logger.error(`Error during WhatsApp logout: ${e.message || 'Unknown error'}`, e);
      }
      this.sock = null;
    }
    await super.destroy();
  }
}

BaseChannel.register('whatsapp', WhatsAppChannel);
module.exports = WhatsAppChannel;
