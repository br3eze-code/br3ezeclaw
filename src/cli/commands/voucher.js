// ==========================================
// AGENTOS VOUCHER COMMAND
// Voucher management — @clack/prompts edition
// ==========================================

'use strict';

const fs   = require('fs');
const QRCode = require('qrcode');
const { intro, outro, spinner, note, log, select, isCancel } = require('@clack/prompts');
const { getDatabase } = require('../../core/database');

// ── Plan definitions (mirrors 36.js CONFIG.VOUCHER_PLANS) ────────────────────
const PLAN_DEFS = {
  '1hour': { label: '1 Hour',   price: 1.00,  duration: '1h'  },
  '1Day':  { label: '1 Day',    price: 5.00,  duration: '24h' },
  '7Day':  { label: '7 Days',   price: 25.00, duration: '7d'  },
  '30Day': { label: '30 Days',  price: 80.00, duration: '30d' },
};

module.exports = (program) => {
  const voucher = program
    .command('voucher')
    .description('Manage access vouchers')
    .alias('v');

  // ── voucher create ────────────────────────────────────────────────────────
  voucher
    .command('create [plan]')
    .description('Create a new voucher (interactive if plan omitted)')
    .option('--duration <duration>', 'Override duration (1h, 24h, 7d)', '')
    .option('--qty <n>', 'Quantity to generate', '1')
    .option('--qr', 'Save QR code to file', false)
    .action(async (plan, options) => {
      const { BRAND, CONFIG_PATH } = global.AGENTOS;

      if (!fs.existsSync(CONFIG_PATH)) {
        log.error('Run agentos onboard first');
        return;
      }

      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

      // Interactive plan selection when omitted
      if (!plan) {
        intro(`${BRAND.emoji}  Create Voucher`);
        const choice = await select({
          message: 'Select plan:',
          options: Object.entries(PLAN_DEFS).map(([k, v]) => ({
            value: k,
            label: `${v.label.padEnd(10)}  $${v.price.toFixed(2)}`,
            hint:  v.duration,
          })),
        });
        if (isCancel(choice)) { log.warn('Cancelled.'); return; }
        plan = choice;
      }

      const planDef = PLAN_DEFS[plan] || { label: plan, price: 0, duration: options.duration || '1h' };
      const duration = options.duration || planDef.duration;
      const qty = Math.max(1, parseInt(options.qty) || 1);

      const s = spinner();
      s.start(`Generating ${qty} voucher(s)…`);

      try {
        const db = await getDatabase();
        const voucherAgent = require('../../core/voucher');
        const created = [];

        for (let i = 0; i < qty; i++) {
          const code = voucherAgent.generate(plan);
          await db.createVoucher(code, {
            plan, duration,
            createdAt: new Date(),
            createdBy: 'cli',
          });
          created.push(code);

          // Auto-print voucher
          try {
            const { printVoucher } = require('../../core/printer');
            const loginUrl = `http://${config.mikrotik?.ip || config.adapters?.mikrotik?.host}/login.html?code=${code}`;
            printVoucher({
              username: code,
              password: code,
              profile: planDef.label,
              loginUrl: loginUrl
            }).catch(e => log.warn('Thermal print failed: ' + e.message));
          } catch (err) {}
        }

        s.stop(`Created ${created.length} voucher(s)`);

        for (const code of created) {
          note(
            [
              `Code  :  ${code}`,
              `Plan  :  ${planDef.label}`,
              `Price :  $${planDef.price.toFixed(2)}`,
              `Valid :  ${duration}`,
            ].join('\n'),
            '🎫 New Voucher'
          );

          if (options.qr) {
            const qrData = JSON.stringify({
              code,
              plan,
              url: `http://${config.mikrotik?.ip || config.adapters?.mikrotik?.host}/login.html?code=${code}`,
            });
            const qrPath = `${global.AGENTOS.STATE_PATH}/qr-${code}.png`;
            await QRCode.toFile(qrPath, qrData);
            log.info(`QR saved: ${qrPath}`);
          }
        }

        outro('Voucher generation complete.');
      } catch (error) {
        s.stop(`Failed: ${error.message}`);
        log.error(error.message);
      }
    });

  // ── voucher list ──────────────────────────────────────────────────────────
  voucher
    .command('list')
    .description('List recent vouchers')
    .option('--limit <n>', 'Number to show', '10')
    .option('--used', 'Show only used vouchers')
    .option('--active', 'Show only active vouchers')
    .action(async (options) => {
      const s = spinner();
      s.start('Fetching vouchers…');

      try {
        const db = await getDatabase();
        let vouchers = await db.getRecentVouchers(parseInt(options.limit));
        if (options.used)   vouchers = vouchers.filter(v => v.used);
        if (options.active) vouchers = vouchers.filter(v => !v.used);
        s.stop(`${vouchers.length} voucher(s) found`);

        if (!vouchers.length) {
          log.warn('No vouchers match the filter.');
          return;
        }

        const lines = vouchers.map((v, i) => {
          const tag = v.used ? '✓ Used  ' : '○ Active';
          const date = v.createdAt?.toDate?.() || v.createdAt || '—';
          return `${String(i + 1).padStart(2)}. [${tag}]  ${(v.id || v.code || '').padEnd(18)}  ${(v.plan || '').padEnd(8)}  ${date}`;
        });

        note(lines.join('\n'), `🎟  Vouchers (${vouchers.length})`);
        outro('Done.');
      } catch (error) {
        log.error(`Failed: ${error.message}`);
      }
    });

  // ── voucher revoke ────────────────────────────────────────────────────────
  voucher
    .command('revoke <code>')
    .description('Revoke an unused voucher')
    .action(async (code) => {
      const s = spinner();
      s.start(`Revoking ${code}…`);
      try {
        const db = await getDatabase();
        const v = await db.getVoucher(code);

        if (!v) { s.stop('Voucher not found'); log.error('Voucher not found'); return; }
        if (v.used) { s.stop('Already used'); log.warn('Voucher already used — cannot revoke'); return; }

        await db.deleteVoucher(code);
        s.stop(`Revoked: ${code}`);
        outro('Done.');
      } catch (error) {
        log.error(`Failed: ${error.message}`);
      }
    });

  // ── voucher debug ─────────────────────────────────────────────────────────
  voucher
    .command('debug')
    .description('Voucher system diagnostics')
    .action(async () => {
      const { BRAND, CONFIG_PATH } = global.AGENTOS;
      intro(`${BRAND.emoji}  Voucher Diagnostics`);

      const checks = [];
      const s = spinner();

      // Config
      s.start('Checking configuration…');
      if (!fs.existsSync(CONFIG_PATH)) {
        s.stop('Config missing');
        checks.push({ name: 'Config', status: 'error', details: 'Run agentos onboard' });
      } else {
        const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        s.stop('Config valid');
        checks.push({ name: 'Config', status: 'ok', details: `prefix: ${cfg.vouchers?.prefix || 'STAR'}` });
      }

      // Database
      s.start('Checking database…');
      try {
        const db = await getDatabase();
        const stats = await db.getStats();
        s.stop('Database reachable');
        checks.push({ name: 'Database', status: 'ok', details: `${db.db ? 'Firebase' : 'Local'}  ${stats.total} total, ${stats.active} active` });
      } catch (e) {
        s.stop(`Database error: ${e.message}`);
        checks.push({ name: 'Database', status: 'error', details: e.message });
      }

      // Generation dry-run
      s.start('Dry-run voucher generation…');
      try {
        const voucherAgent = require('../../core/voucher');
        const sample = voucherAgent.generate('default');
        s.stop(`Sample: ${sample}`);
        checks.push({ name: 'Generator', status: 'ok', details: `sample → ${sample}` });
      } catch (e) {
        s.stop(`Generator error: ${e.message}`);
        checks.push({ name: 'Generator', status: 'error', details: e.message });
      }

      const lines = checks.map(c => {
        const icon = c.status === 'ok' ? '●' : c.status === 'warn' ? '▲' : '■';
        return `${icon} ${c.name.padEnd(12)} ${c.details || ''}`;
      });
      note(lines.join('\n'), '📋 Diagnostics');

      const errors = checks.filter(c => c.status === 'error').length;
      outro(errors === 0 ? '✓ Voucher system is healthy.' : `✗ ${errors} issue(s) found.`);
    });
};
