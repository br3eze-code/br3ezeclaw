// skills/voucher/index.js
// manage_vouchers dispatcher — create, redeem, list, stats, recurring billing
// SPEC.md §4.1 Voucher System

const crypto = require('crypto');

class VoucherSkill {
  async execute(params, context) {
    const { action } = params;
    switch (action) {
      case 'voucher.create':  return this.create(params, context);
      case 'voucher.redeem':  return this.redeem(params, context);
      case 'voucher.list':    return this.list(params, context);
      case 'voucher.stats':   return this.stats(context);
      case 'voucher.revoke':  return this.revoke(params, context);
      case 'voucher.renew':   return this.renew(params, context);
      default:
        throw new Error(`Unknown voucher action: ${action}`);
    }
  }

  // ── Plans ────────────────────────────────────────────────────────
  _plans() {
    return {
      '1hour': { duration: 60 * 60 * 1000,          price: 1.00,  label: '1 Hour' },
      '1Day':  { duration: 24 * 60 * 60 * 1000,     price: 5.00,  label: '1 Day'  },
      '7Day':  { duration: 7  * 24 * 60 * 60 * 1000, price: 25.00, label: '7 Days' },
      '30Day': { duration: 30 * 24 * 60 * 60 * 1000, price: 80.00, label: '30 Days'}
    };
  }

  _generateCode() {
    return 'STAR-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  }

  _expiresAt(plan) {
    const planDef = this._plans()[plan];
    if (!planDef) throw new Error(`Unknown plan: ${plan}. Use: ${Object.keys(this._plans()).join(', ')}`);
    return new Date(Date.now() + planDef.duration).toISOString();
  }

  // ── Create ───────────────────────────────────────────────────────
  async create({ plan, actor, paymentId = null }, context) {
    if (!plan) throw new Error('plan is required (1hour | 1Day | 7Day | 30Day)');
    const plans = this._plans();
    if (!plans[plan]) throw new Error(`Unknown plan: ${plan}`);

    const code      = this._generateCode();
    const now       = new Date().toISOString();
    const expiresAt = this._expiresAt(plan);

    const voucher = {
      id:            code,
      code,
      plan,
      createdAt:     now,
      expiresAt,
      used:          false,
      redeemedAt:    null,
      redeemedBy:    null,
      createdBy:     actor ? `portal:${actor}` : 'system',
      actor:         actor || 'system',
      paymentId,
      paymentStatus: paymentId ? 'pending' : null
    };

    const db = context.db;
    await db.saveVoucher(voucher);

    // Provision on MikroTik via manage_network
    if (context.mikrotik) {
      try {
        await context.mikrotik.addHotspotUser({
          name:     code,
          password: code,
          profile:  plan,
          comment:  `AgentOS voucher ${code}`
        });
      } catch (err) {
        // Log but don't fail — voucher is saved; MikroTik sync can retry
        context.logger?.warn(`VoucherSkill: MikroTik provision failed for ${code}: ${err.message}`);
      }
    }

    // Generate QR data URL
    const qrUrl = `/voucher/${code}/qr`;

    return { success: true, code, plan, expiresAt, price: plans[plan].price, qrUrl, voucher };
  }

  // ── Redeem ───────────────────────────────────────────────────────
  async redeem({ code, user }, context) {
    if (!code || !user) throw new Error('code and user are required');
    const db = context.db;

    const voucher = await db.getVoucher(code);
    if (!voucher)      throw new Error(`Voucher not found: ${code}`);
    if (voucher.used)  throw new Error(`Voucher already used: ${code}`);
    if (new Date(voucher.expiresAt) < new Date()) throw new Error(`Voucher expired: ${code}`);

    const now = new Date().toISOString();
    await db.updateVoucher(code, {
      used:       true,
      redeemedAt: now,
      redeemedBy: user
    });

    return { success: true, code, plan: voucher.plan, redeemedBy: user, redeemedAt: now };
  }

  // ── List ─────────────────────────────────────────────────────────
  async list({ limit = 20, used } = {}, context) {
    const db = context.db;
    const filter = {};
    if (used !== undefined) filter.used = used;
    const vouchers = await db.getVouchers({ ...filter, limit });
    return { success: true, count: vouchers.length, vouchers };
  }

  // ── Stats ────────────────────────────────────────────────────────
  async stats(context) {
    const db = context.db;
    const all  = await db.getVouchers({});
    const used = all.filter(v => v.used);
    const plans = this._plans();
    const revenue = used.reduce((sum, v) => sum + (plans[v.plan]?.price || 0), 0);
    const byPlan  = {};
    for (const v of used) byPlan[v.plan] = (byPlan[v.plan] || 0) + 1;
    return {
      success:   true,
      total:     all.length,
      used:      used.length,
      available: all.length - used.length,
      revenue_usd: revenue.toFixed(2),
      by_plan:   byPlan
    };
  }

  // ── Revoke ───────────────────────────────────────────────────────
  async revoke({ code }, context) {
    if (!code) throw new Error('code is required');
    const db = context.db;
    const voucher = await db.getVoucher(code);
    if (!voucher) throw new Error(`Voucher not found: ${code}`);
    await db.updateVoucher(code, { used: true, revokedAt: new Date().toISOString() });
    if (context.mikrotik) {
      try { await context.mikrotik.removeHotspotUser(code); } catch {}
    }
    return { success: true, code, revoked: true };
  }

  // ── Auto-Renew (Recurring Billing Engine) ────────────────────────
  // Called by guardHotspot reaper in Orchestrator §24 every 1 hour.
  async renew({ code, walletBalance }, context) {
    if (!code) throw new Error('code is required');
    const db = context.db;
    const voucher = await db.getVoucher(code);
    if (!voucher) throw new Error(`Voucher not found: ${code}`);
    const plan    = this._plans()[voucher.plan];
    if (!plan)    throw new Error(`Unknown plan: ${voucher.plan}`);
    if (walletBalance < plan.price) {
      return { success: false, reason: 'insufficient_balance', required: plan.price, balance: walletBalance };
    }
    const newExpiry = this._expiresAt(voucher.plan);
    await db.updateVoucher(code, { expiresAt: newExpiry, used: false });
    return { success: true, code, plan: voucher.plan, newExpiry, deducted: plan.price };
  }

  validate(params) {
    return !!params.action;
  }
}

module.exports = new VoucherSkill();
