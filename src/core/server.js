const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const Joi = require('joi');

const { logger } = require('./logger');
const { getConfig } = require('./config');
const { getDatabase } = require('./database');
const { getMikroTikClient } = require('./mikrotik');

function createApp() {
    const config = getConfig();
    const app = express();

    // Security
    app.use(helmet());
    app.use(cors({
        origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'Authorization']
    }));

    // Rate limiting
    const standardLimiter = rateLimit({
        windowMs: config.security.rateLimitWindow,
        max: config.security.rateLimitMax,
        message: { error: 'Too many requests' }
    });

    app.use(express.json({ limit: '10mb' }));
    app.use(standardLimiter);

    // Request logging
    app.use((req, res, next) => {
        logger.info(`${req.method} ${req.path}`, { ip: req.ip });
        next();
    });

    // Static files
    app.use(express.static('public'));

    // === ROUTES ===

    // Health check
    app.get('/health', async (req, res) => {
        const mikrotik = await getMikroTikClient().catch(() => ({ isConnected: false }));
        const db = await getDatabase();
        const dbStats = await db.getStats();

        res.json({
            status: 'ok',
            service: 'AgentOS',
            version: config.version,
            timestamp: new Date().toISOString(),
            services: {
                mikrotik: mikrotik.isConnected ? 'connected' : 'disconnected',
                database: 'active',
                telegram: config.telegram.token ? 'configured' : 'not_configured'
            },
            stats: dbStats
        });
    });

    // Voucher redemption
    app.post('/voucher/redeem', async (req, res) => {
        try {
            const schema = Joi.object({
                code: Joi.string().pattern(/^AGENT-[A-Z0-9]{6}$/).required(),
                user: Joi.string().alphanum().min(3).max(20).required()
            });

            const { error, value } = schema.validate(req.body);
            if (error) {
                return res.status(400).json({ error: error.details[0].message });
            }

            const { code, user } = value;
            const db = await getDatabase();
            const voucher = await db.getVoucher(code);

            if (!voucher) {
                return res.status(404).json({ error: "Voucher not found" });
            }
            if (voucher.used) {
                return res.status(400).json({ error: "Voucher already used" });
            }

            const mikrotik = await getMikroTikClient();
            if (!mikrotik.isConnected) {
                return res.status(503).json({ error: "Router unavailable" });
            }

            await mikrotik.addHotspotUser(user, user, voucher.plan);
            await db.redeemVoucher(code, { username: user, ip: req.ip });

            logger.info(`Voucher redeemed`, { code, user, plan: voucher.plan });

            res.json({
                status: "activated",
                plan: voucher.plan,
                message: `Access granted: ${voucher.plan}`
            });

        } catch (err) {
            logger.error('Redeem error:', err);
            res.status(500).json({ error: "Failed to activate voucher" });
        }
    });

    // QR code generation
    app.get('/voucher/:code/qr', async (req, res) => {
        try {
            const { code } = req.params;
            const db = await getDatabase();
            const voucher = await db.getVoucher(code);

            if (!voucher) {
                return res.status(404).json({ error: "Voucher not found" });
            }

            const qrData = JSON.stringify({
                code,
                plan: voucher.plan,
                url: `${req.protocol}://${req.get('host')}/login.html?code=${code}`
            });

            const qrImage = await QRCode.toDataURL(qrData);
            res.json({ qr: qrImage, code, plan: voucher.plan });

        } catch (error) {
            logger.error('QR generation error:', error);
            res.status(500).json({ error: "Could not generate QR" });
        }
    });

    // Tool execution endpoint
    app.post('/tool/execute', async (req, res) => {
        try {
            const { tool, params } = req.body;
            const mikrotik = await getMikroTikClient();

            if (!mikrotik.getAvailableTools().includes(tool)) {
                return res.status(400).json({ error: "Unknown tool" });
            }

            const result = await mikrotik.executeTool(tool, ...(params || []));
            res.json({ success: true, result });

        } catch (error) {
            logger.error('Tool execution error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 404 handler
    app.use((req, res) => {
        res.status(404).json({ error: "Not found" });
    });

    // Error handler
    app.use((err, req, res, next) => {
        logger.error('Unhandled error:', err);
        res.status(500).json({ error: "Internal server error" });
    });

    return app;
}

module.exports = { createApp };