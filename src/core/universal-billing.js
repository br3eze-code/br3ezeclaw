// src/core/universal-billing.js
/**
 * Universal Voucher & Billing System
 */

class UniversalBilling {
  constructor(config) {
    this.db = config.database;
    this.paymentProvider = config.paymentProvider; // 'stripe', 'mastercard', 'crypto'
    this.resourceType = config.resourceType || 'generic'; // What the voucher grants access to
  }

  async createVoucher(params) {
    const {
      type = 'access', // 'access', 'credits', 'time', 'usage'
      value, // 24 (hours), 100 (credits), etc.
      resourceId, // What resource this voucher controls
      metadata = {}
    } = params;

    const code = this.generateSecureCode();
    
    const voucher = {
      code,
      type,
      value,
      resourceId,
      status: 'active',
      createdAt: new Date().toISOString(),
      expiresAt: this.calculateExpiry(type, value),
      metadata: {
        ...metadata,
        createdBy: metadata.createdBy || 'system',
        domain: this.resourceType
      },
      redemption: {
        used: false,
        usedAt: null,
        usedBy: null,
        remainingValue: value // For credit-based vouchers
      }
    };

    await this.db.saveVoucher(voucher);
    
    // Generate QR code if needed
    if (metadata.generateQR) {
      voucher.qrCode = await this.generateQR({
        code,
        type: this.resourceType,
        resource: resourceId
      });
    }

    return voucher;
  }

  async redeemVoucher(code, redemptionData) {
    const voucher = await this.db.getVoucher(code);
    
    if (!voucher) throw new Error('Invalid voucher code');
    if (voucher.redemption.used && voucher.type !== 'credits') {
      throw new Error('Voucher already redeemed');
    }
    if (new Date() > new Date(voucher.expiresAt)) {
      throw new Error('Voucher expired');
    }

    // Record redemption
    voucher.redemption.used = true;
    voucher.redemption.usedAt = new Date().toISOString();
    voucher.redemption.usedBy = redemptionData.userId || redemptionData.macAddress;

    // Credit-based: track remaining
    if (voucher.type === 'credits') {
      const amount = redemptionData.amount || voucher.value;
      voucher.redemption.remainingValue -= amount;
      if (voucher.redemption.remainingValue <= 0) {
        voucher.status = 'depleted';
      }
    }

    await this.db.updateVoucher(code, voucher);

    // Provision access based on resource type
    const accessGrant = await this.provisionAccess(voucher, redemptionData);

    return {
      success: true,
      voucher: {
        code: voucher.code,
        type: voucher.type,
        value: voucher.value,
        expiresAt: voucher.expiresAt
      },
      access: accessGrant
    };
  }

  async provisionAccess(voucher, redemptionData) {
    // Domain-specific provisioning
    const provisioners = {
      'network': async () => {
        // Create hotspot user
        return { username: voucher.code, password: voucher.code, profile: 'voucher' };
      },
      
      'compute': async () => {
        // Grant API credits or instance time
        return { credits: voucher.value, instanceToken: generateToken() };
      },
      
      'container': async () => {
        // Registry pull access
        return { registryToken: generateToken(), expires: voucher.expiresAt };
      },
      
      'api': async () => {
        // API key with rate limit
        return { apiKey: generateToken(), rateLimit: voucher.value };
      }
    };

    const provisioner = provisioners[this.resourceType] || provisioners['network'];
    return await provisioner();
  }

  generateSecureCode() {
    // Cryptographically secure code generation
    const crypto = require('crypto');
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    
    // 8 characters = ~40 bits of entropy
    const randomBytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) {
      code += chars[randomBytes[i] % chars.length];
    }
    
    // Add checksum for typo detection
    const checksum = code.split('').reduce((a, b) => a + b.charCodeAt(0), 0) % 10;
    return `${code}${checksum}`;
  }

  calculateExpiry(type, value) {
    const now = new Date();
    switch (type) {
      case 'time': // Hours
        now.setHours(now.getHours() + value);
        break;
      case 'day':
        now.setDate(now.getDate() + value);
        break;
      case 'month':
        now.setMonth(now.getMonth() + value);
        break;
      default:
        now.setDate(now.getDate() + 1); // Default 24h
    }
    return now.toISOString();
  }

  async validateCode(code) {
    const voucher = await this.db.getVoucher(code);
    if (!voucher) return { valid: false, reason: 'not_found' };
    if (voucher.redemption.used && voucher.type !== 'credits') {
      return { valid: false, reason: 'used' };
    }
    if (new Date() > new Date(voucher.expiresAt)) {
      return { valid: false, reason: 'expired' };
    }
    return { valid: true, voucher };
  }
}

module.exports = UniversalBilling;
