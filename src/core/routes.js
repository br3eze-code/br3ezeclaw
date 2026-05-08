'use strict';

const express = require('express');
const Joi = require('joi');
const QRCode = require('qrcode');
const { metrics } = require('./metrics');
const { logger } = require('./logger');
const { ConversationSession } = require('./conversation-session');

/**
 * AgentOS Routes — migrated from ss35.js §16
 */
function createRouter(deps) {
    const router = express.Router();
    const { mikrotik, database, askEngine, financial, nodeRegistry, agentMemory, config, brand } = deps;
    const authMiddleware = (req, res, next) => {
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorised — Bearer token required' });
        const token = auth.split(' ')[1];

        // Use timingSafeEqual to prevent timing attacks
        const crypto = require('crypto');
        const secret = Buffer.from(config.GATEWAY.TOKEN);
        const provided = Buffer.from(token);

        if (provided.length === secret.length && crypto.timingSafeEqual(provided, secret)) {
            return next();
        }
        res.status(401).json({ error: 'Invalid token' });
    };

    const sseClients = new Set();

    router.get('/api/stream', authMiddleware, (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        send('connected', { service: brand.name, version: brand.version });

        const heartbeat = setInterval(() => {
            res.write(': heartbeat\n\n');
        }, 15_000);

        sseClients.add(send);
        req.on('close', () => { clearInterval(heartbeat); sseClients.delete(send); });
    });

    router.get('/health', async (_req, res) => {
        const stats = await database.getStats().catch(() => ({}));
        res.json({
            status: 'ok',
            version: brand.version,
            services: { mikrotik: mikrotik.isConnected, database: database.db ? 'firebase' : 'local' },
            stats,
            metrics: metrics.snapshot(),
        });
    });

    router.get('/api/stats', authMiddleware, async (_req, res) => {
        try {
            const [dbRes, rtRes] = await Promise.allSettled([database.getStats(), mikrotik.getSystemStats()]);
            res.json({
                vouchers: dbRes.status === 'fulfilled' ? dbRes.value : {},
                router: rtRes.status === 'fulfilled' ? rtRes.value : null,
                metrics: metrics.snapshot(),
                mikrotik: mikrotik.isConnected,
            });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.get('/api/vouchers', authMiddleware, async (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit) || 50, 200);
            const used = req.query.used === 'true' ? true : req.query.used === 'false' ? false : undefined;
            const items = await database.listVouchers({ limit, used });
            res.json({ count: items.length, items });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    const redeemSchema = Joi.object({
        code: Joi.string().pattern(/^STAR-[A-Z0-9]{4}-[A-Z0-9]{4}$/).required(),
        user: Joi.string().alphanum().min(3).max(20).required(),
    });

    router.post('/voucher/redeem', async (req, res) => {
        try {
            const { error, value } = redeemSchema.validate(req.body);
            if (error) return res.status(400).json({ error: error.details[0].message });

            const { code, user } = value;
            const voucher = await database.getVoucher(code);
            if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
            if (voucher.used) return res.status(400).json({ error: 'Voucher already used' });
            if (voucher.expiresAt && new Date(voucher.expiresAt) < new Date())
                return res.status(400).json({ error: 'Voucher expired' });
            if (!mikrotik.isConnected) return res.status(503).json({ error: 'Router unavailable' });

            await mikrotik.addHotspotUser(user, user, voucher.plan);
            await database.redeemVoucher(code, { username: user, ip: req.ip });
            res.json({ status: 'activated', plan: voucher.plan });
        } catch (err) {
            metrics.errors++;
            res.status(500).json({ error: 'Failed to activate voucher' });
        }
    });

    router.get('/voucher/:code/qr', async (req, res) => {
        try {
            const voucher = await database.getVoucher(req.params.code);
            if (!voucher) return res.status(404).json({ error: 'Not found' });
            const url = `${req.protocol}://${req.get('host')}/login.html?code=${req.params.code}`;
            const qr = await QRCode.toDataURL(JSON.stringify({ code: req.params.code, plan: voucher.plan, url }));
            res.json({ qr, code: req.params.code, plan: voucher.plan });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.post('/tool/execute', authMiddleware, async (req, res) => {
        try {
            const { tool, params } = req.body;
            if (!tool || !mikrotik.availableTools().includes(tool))
                return res.status(400).json({ error: 'Invalid or unknown tool' });
            const result = await mikrotik.executeTool(tool, ...(params || []));
            res.json({ success: true, result });
        } catch (err) {
            metrics.errors++;
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ── Streaming ask ─
    router.get('/api/ask/stream', authMiddleware, async (req, res) => {
        const input = req.query.q;
        if (!input) return res.status(400).json({ error: 'q query param required' });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const write = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

        try {
            for await (const event of askEngine.stream(input)) {
                write(event.type, event);
                if (event.type === 'message_stop') break;
            }
        } catch (err) {
            write('error', { message: err.message });
        }
        res.end();
    });

    // ── Session replay ────────────────────────────────────────────
    router.get('/api/session/:id', authMiddleware, (req, res) => {
        const session = ConversationSession.load(req.params.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        res.json({ sessionId: session.sessionId, messages: session.messages, usage: session.usage.snapshot() });
    });

    // ── Revenue trends ───────────────────────────────────────────
    router.get('/api/trends', authMiddleware, async (_req, res) => {
        try {
            res.json(await financial.getTrends());
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // ── Mesh node management ─────────────────────────────────────
    router.get('/api/nodes', authMiddleware, (_req, res) => {
        res.json(nodeRegistry.getAll());
    });

    router.post('/api/nodes', authMiddleware, async (req, res) => {
        const { name, ip, user, pass, port } = req.body;
        if (!name || !ip || !user || !pass) return res.status(400).json({ error: 'name, ip, user, pass required' });
        try {
            const node = nodeRegistry.add(name, ip, user, pass, port);
            await node.connect();
            await database.logAuditTrail('api', 'node.add', { name, ip });
            res.json({ success: true, name, status: 'connected' });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.post('/api/nodes/:name/exec', authMiddleware, async (req, res) => {
        const { tool, params } = req.body;
        if (!tool) return res.status(400).json({ error: 'tool required' });
        try {
            const result = await nodeRegistry.executeOnNode(req.params.name, tool, ...(params || []));
            res.json({ success: true, result });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    router.get('/api/mesh/exec', authMiddleware, async (req, res) => {
        const { tool } = req.query;
        if (!tool) return res.status(400).json({ error: 'tool query param required' });
        try {
            const results = await nodeRegistry.executeOnAll(tool);
            res.json({ results });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // ── Agent memory ─────────────────────────────────────────────
    router.get('/api/memory', authMiddleware, (_req, res) => {
        res.json(agentMemory.recallAll());
    });

    router.post('/api/memory', authMiddleware, (req, res) => {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: 'key required' });
        agentMemory.remember(key, value);
        res.json({ success: true });
    });

    router.delete('/api/memory/:key', authMiddleware, (req, res) => {
        agentMemory.forget(req.params.key);
        res.json({ success: true });
    });

    return router;
}

module.exports = { createRouter };
