// ==========================================
// AGENTOS WACLI COMMAND
// WhatsApp CLI — @clack/prompts edition
// ==========================================

'use strict';

const fs   = require('fs');
const path = require('path');

const { intro, outro, spinner, note, log, isCancel } = require('@clack/prompts');
const qrcode       = require('qrcode-terminal');
const { getConfig } = require('../../core/config');

module.exports = (program) => {
  program
    .command('wacli')
    .description('WhatsApp CLI — QR pairing, auth status, and diagnostics')
    .option('--reset',         'Reset auth state (forces QR re-pair)')
    .option('--status',        'Show current WhatsApp auth state')
    .option('--debug-vouchers','Run voucher system diagnostics')
    .action(async (options) => {
      const config   = getConfig();
      const waConfig = config.whatsapp || { enabled: true };

      const authDir = path.resolve(
        process.cwd(),
        waConfig.authStateFolder || 'data/whatsapp_auth'
      );

      // ── --status ────────────────────────────────────────────────────────
      if (options.status) {
        intro('📱 WhatsApp Auth Status');

        const credsFile   = path.join(authDir, 'creds.json');
        const authExists  = fs.existsSync(authDir);
        const credsExist  = fs.existsSync(credsFile);

        note(
          [
            `Auth folder :  ${authDir}`,
            `Auth exists :  ${authExists ? 'yes' : 'no'}`,
            `Creds file  :  ${credsExist ? 'yes — paired' : 'no — needs QR pair'}`,
            `Enabled     :  ${waConfig.enabled ? 'yes' : 'no'}`,
            `Allowed JIDs:  ${waConfig.allowedJids?.length || 0}`,
          ].join('\n'),
          'Session Info'
        );

        outro(credsExist ? '✓ WhatsApp is authenticated.' : '⚠  QR pair required — run: agentos wacli');
        return;
      }

      // ── --reset ─────────────────────────────────────────────────────────
      if (options.reset) {
        intro('🔄 Reset WhatsApp Auth');
        if (fs.existsSync(authDir)) {
          const s = spinner();
          s.start(`Clearing: ${authDir}…`);
          fs.rmSync(authDir, { recursive: true, force: true });
          s.stop('Auth state cleared');
          outro('Run `agentos wacli` to generate a new QR code.');
        } else {
          log.warn('No WhatsApp auth state found — nothing to reset.');
          outro('Done.');
        }
        return;
      }

      // ── --debug-vouchers ─────────────────────────────────────────────────
      if (options.debugVouchers) {
        intro('🔍 Voucher Diagnostics (WACLI)');
        const checks = [];
        const s = spinner();

        s.start('Connecting to database…');
        try {
          const { getDatabase } = require('../../core/database');
          const db    = await getDatabase();
          const stats = await db.getStats();
          s.stop('Database reachable');
          checks.push({ name: 'Database', ok: true, detail: `${db.db ? 'Firebase' : 'Local'}  total=${stats.total || 0} active=${stats.active || 0}` });
        } catch (e) {
          s.stop(`Database error: ${e.message}`);
          checks.push({ name: 'Database', ok: false, detail: e.message });
        }

        s.start('Dry-run voucher generation…');
        try {
          const voucherAgent = require('../../core/voucher');
          const sample = voucherAgent.generate('default');
          s.stop(`Sample: ${sample}`);
          checks.push({ name: 'Generator', ok: true, detail: `sample → ${sample}` });
        } catch (e) {
          s.stop(`Generator error: ${e.message}`);
          checks.push({ name: 'Generator', ok: false, detail: e.message });
        }

        const lines = checks.map(c =>
          `${c.ok ? '●' : '■'} ${c.name.padEnd(12)}  ${c.detail}`
        );
        note(lines.join('\n'), '📋 Diagnostics');

        const errors = checks.filter(c => !c.ok).length;
        outro(errors === 0 ? '✓ Voucher system is healthy.' : `✗ ${errors} issue(s) found.`);
        return;
      }

      // ── Interactive QR pair ──────────────────────────────────────────────
      intro('📱 WhatsApp QR Pairing');
      log.info(`Auth folder: ${authDir}`);

      const WhatsAppChannel = require('../../core/channels/WhatsappChannel');
      const stubAgent = {};

      waConfig.authStateFolder = authDir;
      waConfig.enabled = true;

      const channel = new WhatsAppChannel(waConfig, stubAgent);

      channel.on('qr', (qrStr) => {
        console.log('\n');
        log.step('Scan this QR code with WhatsApp on your phone:');
        qrcode.generate(qrStr, { small: true });
        log.info('Waiting for scan…');
      });

      channel.on('connected', () => {
        outro('✓ WhatsApp paired and connected! You can now run: agentos gateway');
        setTimeout(() => process.exit(0), 1000);
      });

      channel.on('logout', () => {
        log.error('WhatsApp logged out during pairing.');
        log.info('Run with --reset then try again.');
        process.exit(1);
      });

      const s = spinner();
      s.start('Initializing WhatsApp channel…');

      try {
        await channel.initialize();
        s.stop('WhatsApp channel ready — waiting for QR scan');
      } catch (e) {
        s.stop(`Initialization failed: ${e.message}`);
        log.error(e.message);
        process.exit(1);
      }
    });
};
