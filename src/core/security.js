// src/core/security.js
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const hpp = require('hpp');
const xss = require('xss-clean');

class SecurityManager {
  constructor() {
    this.encryptionKey = process.env.AGENTOS_MASTER_KEY || crypto.randomBytes(32);
    this.failedAttempts = new Map();
    this.blockedIPs = new Set();
  }

  // Encrypt sensitive data (WhatsApp credentials, tokens)
  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-gcm', this.encryptionKey);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decrypt(encryptedData) {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
    const decipher = crypto.createDecipher('aes-256-gcm', this.encryptionKey);
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  // Input validation for network commands
  sanitizeHost(host) {
    // Prevent command injection
    if (!/^[\w\.-]+$/.test(host)) {
      throw new Error('Invalid hostname format');
    }
    // Prevent internal IP scanning
    const forbidden = ['127.0.0.1', 'localhost', '0.0.0.0', '::1'];
    if (forbidden.includes(host.toLowerCase())) {
      throw new Error('Forbidden host');
    }
    return host;
  }

  // Rate limiter for messaging channels
  getMessageLimiter() {
    return rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 30, // 30 messages per minute
      message: 'Too many messages, please slow down',
      standardHeaders: true,
      legacyHeaders: false,
    });
  }

  // Express security middleware stack
  getSecurityMiddleware() {
    return [
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            connectSrc: ["'self'", 'wss:', 'https://*.firebaseio.com'],
            scriptSrc: ["'self'", "'unsafe-inline'"], // For dashboard UI
          },
        },
        hsts: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true
        }
      }),
      hpp(), // Prevent HTTP Parameter Pollution
      xss(), // XSS sanitization
      this.auditMiddleware.bind(this)
    ];
  }

  // Audit logging middleware
  auditMiddleware(req, res, next) {
    const { logger } = require('./logger');
    const start = Date.now();
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.audit('http_request', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        correlationId: req.correlationId,
        // Sanitize body to avoid logging passwords
        body: this.sanitizeBody(req.body)
      });
    });
    
    next();
  }

  sanitizeBody(body) {
    if (!body) return body;
    const sensitive = ['password', 'token', 'secret', 'key', 'credential'];
    const sanitized = { ...body };
    for (const key of Object.keys(sanitized)) {
      if (sensitive.some(s => key.toLowerCase().includes(s))) {
        sanitized[key] = '[REDACTED]';
      }
    }
    return sanitized;
  }
}

module.exports = new SecurityManager();
