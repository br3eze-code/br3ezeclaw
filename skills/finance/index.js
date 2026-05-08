// skills/finance/index.js
// manage_finance dispatcher — revenue, P2P credits, Mastercard A2A
// SPEC.md §4.7 §9 Financial Engine

class FinanceSkill {
  async execute(params, context) {
    const { action, ...args } = params;
    switch (action) {
      case 'finance.report': return this.report(context);
      case 'finance.trends': return this.trends(context);
      case 'finance.audit': return this.audit(args, context);
      case 'p2p.transfer': return this.p2pTransfer(args, context);
      case 'p2p.resolve': return this.p2pResolve(args, context);
      case 'mastercard.initiate': return this.mastercardInitiate(args, context);
      case 'mastercard.status': return this.mastercardStatus(args, context);
      default:
        throw new Error(`Unknown finance action: ${action}`);
    }
  }

  // ── Revenue Report ───────────────────────────────────────────────
  async report(context) {
    const db = context.db;
    const vouchers = await db.getVouchers({ used: true });
    const byPlan = {};
    let total = 0;
    for (const v of vouchers) {
      const plan = v.plan || 'unknown';
      const price = this._planPrice(plan);
      byPlan[plan] = (byPlan[plan] || 0) + price;
      total += price;
    }
    return {
      success: true,
      total_usd: total.toFixed(2),
      by_plan: byPlan,
      voucher_count: vouchers.length
    };
  }

  // ── 7-Day Trend ─────────────────────────────────────────────────
  async trends(context) {
    const db = context.db;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const vouchers = await db.getVouchers({ used: true, since });
    const days = {};
    for (const v of vouchers) {
      const day = v.redeemedAt?.slice(0, 10) || v.createdAt?.slice(0, 10);
      if (day) {
        days[day] = (days[day] || 0) + this._planPrice(v.plan);
      }
    }
    return { success: true, trends: days };
  }

  // ── Audit Trail ─────────────────────────────────────────────────
  async audit({ limit = 50 }, context) {
    const db = context.db;
    const events = await db.getAuditTrail(limit);
    return { success: true, count: events.length, events };
  }

  // ── Enhanced P2P Transfer ────────────────────────────────────────
  async p2pTransfer({ from, to, amount, currency = 'USD' }, context) {
    if (!from || !to || !amount) throw new Error('from, to, and amount are required');
    const db = context.db;

    // Resolve recipient identity
    const recipient = await this.p2pResolve({ identifier: to }, context);
    if (!recipient.uid) throw new Error(`Could not resolve recipient: ${to}`);

    // Fee calculation
    const feePercent = parseFloat(process.env.P2P_FEE_PERCENT || '0');
    const feeFlat = parseFloat(process.env.P2P_FEE_FLAT || '0');
    const fee = (amount * feePercent / 100) + feeFlat;
    const net = amount - fee;

    // Dual-entry bookkeeping
    await db.recordTransaction({
      type: 'p2p_transfer_sent',
      actor: from,
      to: recipient.uid,
      amount: -amount,
      fee,
      currency,
      timestamp: new Date().toISOString()
    });
    await db.recordTransaction({
      type: 'p2p_transfer_received',
      actor: recipient.uid,
      from,
      amount: net,
      currency,
      timestamp: new Date().toISOString()
    });

    return {
      success: true,
      sent: amount,
      fee: fee,
      net_received: net,
      recipient_uid: recipient.uid,
      recipient_name: recipient.display,
      currency
    };
  }

  // Resolve phone/email/username → Firebase UID
  async p2pResolve({ identifier }, context) {
    if (!identifier) throw new Error('identifier required');
    const db = context.db;

    // Try phone (E.164), email, then username
    let user = null;
    if (/^\+\d{7,15}$/.test(identifier)) user = await db.getUserByPhone(identifier);
    else if (identifier.includes('@')) user = await db.getUserByEmail(identifier);
    else user = await db.getUserByUsername(identifier);

    if (!user) return { success: false, uid: null, message: `No user found for: ${identifier}` };

    return {
      success: true,
      uid: user.uid || user.id,
      display: user.username || user.email || user.phoneNumber || user.id
    };
  }

  // ── Mastercard A2A ───────────────────────────────────────────────
  async mastercardInitiate({ voucherCode, amount, currency = 'USD' }, context) {
    const MastercardA2AService = context.billing?.mastercardService;
    if (!MastercardA2AService) throw new Error('Mastercard A2A service not initialized');
    const result = await MastercardA2AService.initiatePayment({ voucherCode, amount, currency });
    return { success: true, paymentId: result.paymentId, redirectUrl: result.redirectUrl };
  }

  async mastercardStatus({ paymentId }, context) {
    const MastercardA2AService = context.billing?.mastercardService;
    if (!MastercardA2AService) throw new Error('Mastercard A2A service not initialized');
    const status = await MastercardA2AService.getPaymentStatus(paymentId);
    return { success: true, paymentId, status };
  }

  // ── Helpers ──────────────────────────────────────────────────────
  _planPrice(plan) {
    const prices = { '1hour': 0.50, '1Day': 2.00, '7Day': 3.00, '30Day': 6.00 };
    return prices[plan] || 0;
  }

  validate(params) {
    return !!params.action;
  }
}

module.exports = new FinanceSkill();
