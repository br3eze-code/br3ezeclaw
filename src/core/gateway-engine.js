// src/core/gateway-engine.js 
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const compression = require('compression');
const EventEmitter = require('events');
const path = require('path');

const security = require('./security');
const { logger } = require('./logger');
const ChannelManager = require('./channels/ChannelManager');
const MobileBridge = require('../api/mobile-bridge');
const AICoordinator = require('../ai/coordinator');
const { metrics } = require('./metrics');

// A2A Protocol Plugin
let a2aPlugin;
try {
  a2aPlugin = require('../../core/plugins/a2a-protocol');
} catch (e) {
  logger.warn('A2A Protocol Plugin not found, cross-agent communication may be limited.');
}

class Gateway extends EventEmitter {
  constructor(config = {}) {
    super();
    // Resolve token from nested gateway config → top-level → env
    const resolvedToken =
      config.gateway?.token ||
      config.token ||
      process.env.AGENTOS_GATEWAY_TOKEN ||
      process.env.GATEWAY_TOKEN;

    this.config = {
      port: config.port || config.gateway?.port || 19876,
      host: config.host || config.gateway?.host || '127.0.0.1',
      token: resolvedToken,
      ...config
    };

    // Log token prefix so operators can verify it loaded
    if (resolvedToken) {
      logger.info(`Gateway token loaded: ${resolvedToken.substring(0, 8)}…`);
    } else {
      logger.warn('⚠️  No gateway token set — API routes are unauthenticated. Set AGENTOS_GATEWAY_TOKEN.');
    }

    this.app = express();
    this.server = null;
    this.ai = new AICoordinator(this.config);
    this.channelManager = new ChannelManager(this.ai);

    // Relay special events from ChannelManager to system
    this.channelManager.on('qr', (data) => {
      logger.info(`Relaying QR code for ${data.channel}`);
      this.broadcast({ type: 'qr', payload: data }, 'websocket');
    });

    this.channelManager.on('command', (data) => {
      logger.info(`Received command ${data.command} from ${data.channel}`);
      if (data.command === 'initiate-whatsapp') {
        this._handleWhatsAppInitiation();
      }
    });

    this.channelManager.on('status', (data) => {
      logger.info(`Channel status update: ${data.channel} is now ${data.status}`);
      this.broadcast({ type: 'channel-status', payload: data }, 'websocket');
    });

    this._setupExpress();
  }


  async _handleWhatsAppInitiation() {
    try {
      logger.info('Starting WhatsApp initiation flow...');
      // If channel exists, we might need to reset it or just let it re-initialize
      // For now, let's ensure it's registered
      if (!this.channelManager.channels.has('whatsapp')) {
        await this.channelManager.register({
          type: 'whatsapp',
          config: this.config.whatsapp || { enabled: true }
        });
      } else {
        // Force a re-init if possible or just log
        logger.info('WhatsApp channel already registered, ensuring connection...');
      }
    } catch (error) {
      logger.error('Failed to initiate WhatsApp:', error);
    }
  }

  _setupExpress() {
    this.app.use(security.getSecurityMiddleware());
    this.app.use(compression());
    this.app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
    this.app.use(express.json({ limit: '10kb' }));

    // Dynamic config injection for frontend
    this.app.get('/js/env.js', (req, res) => {
      res.type('application/javascript');
      res.send(`
        window.ENV = {
          FIREBASE_PROJECT_ID: "${process.env.FIREBASE_PROJECT_ID || ''}",
          FIREBASE_API_KEY: "${process.env.FIREBASE_API_KEY || ''}",
          GATEWAY_PORT: "${process.env.GATEWAY_PORT || '19876'}",
          GATEWAY_TOKEN: "${this.config.token || ''}",
          ALLOWED_ORIGINS: "${process.env.ALLOWED_ORIGINS || '*'}"
        };
      `);
    });

    // Serve static frontend files from www/
    this.app.use(express.static(path.join(process.cwd(), 'www')));

    // ── Health ────────────────────────────────────────────────────────────────
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        channels: Object.keys(this.channelManager.getStatus())
      });
    });

    // ── Bearer token middleware for /api routes ────────────────────────────────
    this.app.use('/api', (req, res, next) => {
      const token = this.config.token;
      if (!token) return next(); // No token configured — open access
      const auth = req.headers['authorization'] || '';
      const provided = auth.startsWith('Bearer ') ? auth.slice(7) : null;
      if (provided !== token) {
        return res.status(401).json({ error: 'Unauthorized — invalid or missing Bearer token' });
      }
      next();
    });

    // ── SSE streaming /ask ────────────────────────────────────────────────────
    this.app.post('/api/v1/ask', async (req, res) => {
      const { prompt, stream: wantStream } = req.body || {};
      if (!prompt) return res.status(400).json({ error: 'prompt required' });
      if (!this.askEngine) return res.status(503).json({ error: 'AskEngine not initialized' });

      if (wantStream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        try {
          for await (const ev of this.askEngine.stream(prompt)) {
            res.write(`data: ${JSON.stringify(ev)}\n\n`);
          }
        } catch (e) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`);
        }
        res.end();
      } else {
        try {
          const result = await this.askEngine.run(prompt);
          res.json({ ok: true, ...result });
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
      }
    });

    // ── A2A Protocol Routes ───────────────────────────────────────────────────
    if (a2aPlugin && typeof a2aPlugin.onRegisterRoutes === 'function') {
      const a2aRouter = express.Router();
      a2aPlugin.onRegisterRoutes({ logger }, a2aRouter);
      this.app.use(a2aRouter);
    }

    // ── Email Webhook Capture ────────────────────────────────────────────────
    this.app.post('/api/v1/webhooks/email', express.urlencoded({ extended: true }), async (req, res) => {
      try {
        const emailChannel = this.channelManager.channels.get('email');
        if (!emailChannel) return res.status(503).json({ error: 'Email channel not active' });
        
        // Parse common webhook payloads (SendGrid Inbound Parse, Mailgun, etc.)
        const payload = req.body;
        const sender = payload.sender || payload.from || payload.envelope?.from;
        const subject = payload.subject || '';
        const text = payload.text || payload['body-plain'] || '';

        if (!sender) return res.status(400).json({ error: 'Sender address missing' });

        // Strip out Name <email@domain.com> to just email@domain.com if needed
        const emailMatch = sender.match(/<(.+)>/);
        const emailAddress = emailMatch ? emailMatch[1] : sender;

        await emailChannel.adapter.handleIncomingEmail(emailAddress, subject, text, payload);
        res.status(200).send('OK');
      } catch (err) {
        logger.error(`Email webhook error: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    });

    // ── Voucher routes ────────────────────────────────────────────────────────
    this.app.get('/api/v1/vouchers/stats', async (req, res) => {
      try {
        if (!global.database) return res.status(503).json({ error: 'Database not ready' });
        res.json(await global.database.getStats());
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    this.app.post('/api/v1/vouchers', async (req, res) => {
      try {
        if (!global.database) return res.status(503).json({ error: 'Database not ready' });
        const crypto = require('crypto');
        const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
        const code = `STAR-${part()}-${part()}`;
        const { DEFAULT_PLANS } = require('./database');
        const dateUtils = require('../utils/date');
        const plan = req.body.plan || 'default';
        const planObj = DEFAULT_PLANS[plan] || { name: 'Custom', deviceLimit: 1 };

        const mt = global.mikrotik;
        const expiresAt = planObj.durationValue && planObj.durationUnit ?
          dateUtils.add(new Date(), planObj.durationValue, planObj.durationUnit).toISOString() : null;
        const loginUrl = `http://${mt?.config?.host || 'hotspot.local'}/login?username=${code}&password=${code}`;

        const vData = {
          ...req.body,
          plan,
          planName: req.body.planName || planObj.name || plan,
          durationUnit: req.body.durationUnit || planObj.durationUnit || null,
          durationValue: req.body.durationValue || planObj.durationValue || null,
          deviceLimit: req.body.deviceLimit || planObj.deviceLimit || 1,
          expiresAt: req.body.expiresAt || expiresAt,
          loginUrl: req.body.loginUrl || loginUrl,
          createdBy: req.body.createdBy || 'api'
        };

        const voucher = await global.database.createVoucher(code, vData);

        if (mt && mt.state.isConnected) {
          try {
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
              username: code, password: code, profile: plan,
              sharedUsers: vData.deviceLimit,
              ...(vData.expiresAt && { limitUptime: _durationToMikrotik(vData) })
            });
          } catch (err) {
            logger.error('Failed to add voucher to Mikrotik:', err.message);
          }
        }
        res.json({ ok: true, voucher });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    this.app.post('/api/v1/vouchers/redeem', async (req, res) => {
      try {
        const { code, user } = req.body;
        if (!code || !user) return res.status(400).json({ error: 'code and user required' });
        if (!global.mikrotik || !global.mikrotik.state?.isConnected) return res.status(503).json({ error: 'Router unavailable' });

        const voucher = await global.database.getVoucher(code);
        if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
        if (voucher.used) return res.status(400).json({ error: 'Voucher already used' });

        await global.mikrotik.addHotspotUser(user, user, voucher.planId || voucher.plan);
        await global.database.redeemVoucher(code, { username: user, ip: req.ip });
        res.json({ ok: true, status: 'activated', plan: voucher.planId || voucher.plan });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    this.app.post('/api/v1/users/sync', async (req, res) => {
      try {
        const { user, planId } = req.body;
        if (!user || !planId) return res.status(400).json({ error: 'user and planId required' });
        if (global.mikrotik && global.mikrotik.state?.isConnected) {
          await global.mikrotik.addHotspotUser(user, user, planId);
        }
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    this.app.get('/api/v1/vouchers/:code/qr', async (req, res) => {
      try {
        const QRCode = require('qrcode');
        const voucher = await global.database.getVoucher(req.params.code);
        if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
        const url = `${req.protocol}://${req.get('host')}/login.html?code=${req.params.code}`;
        const qr = await QRCode.toDataURL(JSON.stringify({ code: req.params.code, plan: voucher.plan, url }));
        res.json({ ok: true, qr, code: req.params.code, plan: voucher.plan });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── MikroTik tool execution ───────────────────────────────────────────────
    this.app.post('/api/v1/tools/:tool', async (req, res) => {
      try {
        if (!global.mikrotik) return res.status(503).json({ error: 'MikroTik not connected' });
        const result = await global.mikrotik.executeTool(req.params.tool, req.body);
        res.json({ ok: true, result });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    this.app.get('/api/v1/tools', (req, res) => {
      if (!global.mikrotik) return res.json({ tools: [] });
      res.json({ tools: global.mikrotik.getAvailableTools() });
    });

    // ── Financial trends ──────────────────────────────────────────────────────
    this.app.get('/api/v1/trends', async (req, res) => {
      try {
        if (!global.financial) return res.status(503).json({ error: 'Financial service not ready' });
        res.json(await global.financial.getTrends());
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── Mesh nodes ───────────────────────────────────────────────────────────
    this.app.get('/api/v1/nodes', (req, res) => {
      if (!global.nodeRegistry) return res.json({ nodes: [] });
      res.json(global.nodeRegistry.getAll());
    });

    this.app.post('/api/v1/nodes', async (req, res) => {
      try {
        if (!global.nodeRegistry) return res.status(503).json({ error: 'NodeRegistry not ready' });
        const { name, ip, user, pass, port } = req.body;
        const node = global.nodeRegistry.add(name, ip, user, pass, port);
        await node.connect();
        res.json({ ok: true, name, status: 'connected' });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── Memory & Sessions ────────────────────────────────────────────────────
    this.app.get('/api/v1/sessions/:id', async (req, res) => {
      try {
        if (!global.memoryManager) return res.status(503).json({ error: 'Memory service not ready' });
        const session = await global.memoryManager.getSession(req.params.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        res.json(session);
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    this.app.get('/api/v1/users/:id/memory', async (req, res) => {
      try {
        if (!global.memoryManager) return res.status(503).json({ error: 'Memory service not ready' });
        const history = await global.memoryManager.adapter.get(`user:${req.params.id}:history`) || [];
        const context = await global.memoryManager.getUserContext(req.params.id);
        res.json({ history, context });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    this.app.post('/api/v1/users/:id/permissions', async (req, res) => {
      try {
        if (!global.memoryManager) return res.status(503).json({ error: 'Memory service not ready' });
        const { permissions } = req.body;
        if (!Array.isArray(permissions)) return res.status(400).json({ error: 'permissions must be an array' });
        await global.memoryManager.setPermissions(req.params.id, permissions);
        res.json({ ok: true, permissions });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── Additional Voucher / Payment ──────────────────────────────────────────
    this.app.post('/api/v1/vouchers/pay', async (req, res) => {
      try {
        const { plan, amount, method } = req.body;
        if (!plan || !amount) return res.status(400).json({ error: 'plan and amount required' });

        const { DEFAULT_PLANS } = require('./database');
        const dateUtils = require('../utils/date');

        const planObj = DEFAULT_PLANS[plan] || { name: 'Custom', deviceLimit: 1 };
        const expiresAt = planObj.durationValue && planObj.durationUnit ?
          dateUtils.add(new Date(), planObj.durationValue, planObj.durationUnit).toISOString() : null;

        // This would integrate with UniversalBilling/Payment providers
        const crypto = require('crypto');
        const code = `PAY-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

        const loginUrl = `http://${global.mikrotik?.config?.host || global.AGENTOS?.dnsName || 'hotspot.local'}/login?username=${code}&password=${code}`;

        if (global.database) {
          await global.database.createVoucher(code, {
            planId: plan,
            planName: planObj.name || planId,
            durationUnit: planObj.durationUnit || null,
            durationValue: planObj.durationValue || null,
            deviceLimit: planObj.deviceLimit || 1,
            expiresAt,
            loginUrl,
            amount,
            method,
            status: 'paid',
            createdBy: 'api-pay'
          });

          // Auto provision on payment
          if (global.mikrotik && global.mikrotik.state?.isConnected) {
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
            await global.mikrotik.addHotspotUser({
              username: code, password: code, profile: plan,
              sharedUsers: planObj.deviceLimit || 1,
              ...(expiresAt && { limitUptime: _durationToMikrotik(planObj) })
            }).catch(() => { });
          }
        }

        res.json({ ok: true, code, status: 'paid' });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── Mobile bridge ────────────────────────────────────────────────────────
    try {
      const mobileBridge = new MobileBridge();
      this.app.use('/api/v1/mobile', mobileBridge.getRouter());
    } catch (e) {
      logger.warn('MobileBridge not available:', e.message);
    }

    this.app.use((err, req, res, next) => {
      logger.error('Express error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  async start() {
    logger.info('Starting AgentOS Gateway services...');

    // Resource monitoring log
    const { rss, heapUsed } = process.memoryUsage();
    logger.debug(`Initial memory usage: RSS=${Math.round(rss / 1024 / 1024)}MB, Heap=${Math.round(heapUsed / 1024 / 1024)}MB`);

    // Initialize A2A Protocol if available
    if (a2aPlugin) {
      try {
        a2aPlugin.onBootstrap({
          logger,
          metrics,
          eventBus: this
        });

        // Register the gateway itself as an A2A participant
        // This allows other agents to "talk" to the gateway
        const gatewayContext = {
          id: 'gateway',
          capabilities: ['system', 'mikrotik', 'billing'],
          send: async (msg) => {
            logger.info(`Gateway received A2A message: ${JSON.stringify(msg)}`);
            this.emit('a2a.message', msg);
            return { delivered: true };
          }
        };

        // A2APlugin stores adapters in a Map. We can manually add it 
        // or trigger onAgentInit if we had a proper agent object.
        // For the gateway, we'll expose it as a virtual agent.
        if (a2aPlugin.adapters) {
          a2aPlugin.adapters.set('gateway', gatewayContext);
          logger.info('A2A Protocol: Gateway registered as "gateway" node');
        }
      } catch (e) {
        logger.error(`Failed to initialize A2A Protocol: ${e.message}`);
      }
    }

    this.server = http.createServer(this.app);

    // Initialize channels via ChannelManager
    logger.debug('Initializing Channel Manager...');

    // 1. WebSocket Channel (Always enabled for frontend)
    logger.debug('Registering WebSocket channel...');
    await this.channelManager.register({
      type: 'websocket',
      config: {
        server: this.server,
        path: '/ws',
        token: this.config.token
      }
    });

    // 2. WhatsApp Channel
    if (this.config.whatsapp?.enabled) {
      logger.debug('Registering WhatsApp channel...');
      await this.channelManager.register({
        type: 'whatsapp',
        config: this.config.whatsapp
      });
    }

    // 3. Telegram Channel
    if (this.config.telegram?.token) {
      logger.debug('Registering Telegram channel...');
      await this.channelManager.register({
        type: 'telegram',
        config: this.config.telegram
      });
    }

    // 4. Slack Channel
    if (this.config.slack?.token) {
      logger.debug('Registering Slack channel...');
      await this.channelManager.register({
        type: 'slack',
        config: this.config.slack
      });
    }

    // 5. Discord Channel
    if (this.config.discord?.token) {
      logger.debug('Registering Discord channel...');
      await this.channelManager.register({
        type: 'discord',
        config: this.config.discord
      });
    }

    // Start listening
    logger.debug(`Binding server to ${this.config.host}:${this.config.port}...`);
    await new Promise((resolve, reject) => {
      // The http.Server emits 'error' (not a callback argument) on EADDRINUSE.
      // We must listen for it BEFORE calling .listen(), otherwise the rejection
      // is unhandled and crashes the process before our catch block can act.
      const onError = (err) => {
        this.server.removeListener('error', onError);
        logger.error(`Gateway bind failed on port ${this.config.port}: ${err.message}`);
        reject(err);
      };
      this.server.once('error', onError);

      this.server.listen(this.config.port, this.config.host, () => {
        this.server.removeListener('error', onError);
        resolve();
      });
    });

    logger.info(`✅ Gateway listening on ${this.config.host}:${this.config.port}`);

    // Start Billing Reaper if billing is available
    if (global.billing && typeof global.billing.startReaper === 'function') {
      global.billing.startReaper();
    }

    this.emit('started');
    return this;
  }

  async stop() {
    logger.info('Shutting down Gateway...');

    if (this.channelManager) {
      logger.debug('Closing all channels...');
      await this.channelManager.closeAll();
    }

    if (this.server) {
      logger.debug('Closing HTTP/WebSocket server...');
      await new Promise((resolve) => {
        // Force-close all keep-alive connections so the port is freed
        // immediately and the next PM2 restart doesn't hit EADDRINUSE.
        if (typeof this.server.closeAllConnections === 'function') {
          // Node 18.2+ fast path
          this.server.closeAllConnections();
        }

        const forceKill = setTimeout(() => {
          logger.warn('Gateway stop: forcibly destroying remaining sockets.');
          if (typeof this.server.closeAllConnections === 'function') {
            this.server.closeAllConnections();
          }
          resolve();
        }, 5000);
        forceKill.unref(); // don't block process exit

        this.server.close((err) => {
          clearTimeout(forceKill);
          if (err) logger.warn(`Gateway stop: ${err.message}`);
          resolve();
        });
      });
    }

    logger.info('✓ Gateway stopped gracefully');
    this.emit('stopped');
  }

  broadcast(message, channel = null) {
    this.channelManager.broadcast(message, (type) => !channel || type === channel);
  }
}

async function startGateway(config) {
  const gateway = new Gateway(config);
  return await gateway.start();
}

module.exports = { Gateway, startGateway };
