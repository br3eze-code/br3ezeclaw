// src/api/mobile-bridge.js
const express = require('express');
const jwt = require('jsonwebtoken');
const { getManager } = require('../core/mikrotik');
const { getDatabase } = require('../core/database');
const security = require('../core/security');
const { QNAPProcessor } = require('../ai/qnap-integration');
const { logger } = require('../core/logger');

class MobileBridge {
  constructor() {
    this.router = express.Router();
    this.qnap = new QNAPProcessor();
    this._setupRoutes();
  }

  _setupRoutes() {
    // Authentication middleware for mobile
    const authenticate = async (req, res, next) => {
      try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) throw new Error('No token');
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.uid;
        next();
      } catch (error) {
        res.status(401).json({ error: 'Unauthorized' });
      }
    };

    // Validate voucher (called from captive portal)
    this.router.post('/voucher/validate', async (req, res) => {
      try {
        const { code, macAddress, deviceFingerprint } = req.body;
        
        // Q-NAP fraud check
        const fraudCheck = await this.qnap.analyzeTransaction({
          userId: macAddress,
          amount: 0,
          timestamp: Date.now(),
          deviceFingerprint
        });

        const db = await getDatabase();
        const voucher = await db.getVoucher(code);

        if (!voucher) {
          return res.status(404).json({ valid: false, error: 'Invalid code' });
        }

        if (voucher.used) {
          return res.status(400).json({ valid: false, error: 'Code already used' });
        }

        if (fraudCheck.riskScore > 0.9) {
          logger.audit('voucher_fraud_blocked', { code, macAddress, score: fraudCheck.riskScore });
          return res.status(403).json({ valid: false, error: 'Security check failed' });
        }

        // Activate on MikroTik
        const mt = getManager();
        await mt.addHotspotUser(
          `voucher_${code}`,
          code,
          voucher.plan || 'default'
        );

        // Mark as used
        await db.redeemVoucher(code, {
          macAddress,
          activatedAt: new Date().toISOString(),
          deviceFingerprint
        });

        res.json({
          valid: true,
          plan: voucher.plan,
          expiresAt: this._calculateExpiry(voucher.plan),
          riskCheck: fraudCheck.recommendation
        });

      } catch (error) {
        logger.error('Voucher validation error:', error);
        res.status(500).json({ error: 'Internal error' });
      }
    });

    // Get hotspot status (for mobile dashboard)
    this.router.get('/status', authenticate, async (req, res) => {
      try {
        const mt = getManager();
        const [stats, activeUsers] = await Promise.all([
          mt.getSystemStats(),
          mt.getActiveUsers()
        ]);

        res.json({
          online: mt.state.isConnected,
          cpu: stats['cpu-load'],
          memory: stats['memory-usage-percent'],
          uptime: stats.uptime,
          activeUsers: activeUsers.length,
          gatewayVersion: process.env.npm_package_version
        });
      } catch (error) {
        res.status(503).json({ error: 'Router unavailable' });
      }
    });

    // Sync user data with Power Connect
    this.router.post('/sync', authenticate, async (req, res) => {
      try {
        const { subscriptions, deviceToken } = req.body;
        const db = await getDatabase();
        
        // Store in Firebase for cross-device sync
        await db.syncUserData(req.userId, {
          subscriptions,
          deviceToken,
          lastSync: new Date().toISOString()
        });

        res.json({ success: true, timestamp: Date.now() });
      } catch (error) {
        res.status(500).json({ error: 'Sync failed' });
      }
    });

    // Real-time notifications webhook
    this.router.post('/notify', authenticate, async (req, res) => {
      const { type, message, priority } = req.body;
      
      // Forward to Telegram if linked
      if (req.userId) {
        // Notification logic
      }
      
      res.json({ queued: true });
    });
  }

  _calculateExpiry(plan) {
    const hours = { '1hour': 1, '1day': 24, '1week': 168 };
    const date = new Date();
    date.setHours(date.getHours() + (hours[plan] || 24));
    return date.toISOString();
  }

  getRouter() {
    return this.router;
  }
}

module.exports = MobileBridge;
