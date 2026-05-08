// ==========================================
// AGENTOS DAHUA COMMAND
// Camera management — @clack/prompts edition
// ==========================================

'use strict';

const fs   = require('fs');
const { intro, outro, spinner, note, log, confirm, isCancel } = require('@clack/prompts');
const { CONFIG_PATH } = require('../../core/config');

module.exports = (program) => {
  const dahua = program
    .command('dahua')
    .description('Manage Dahua cameras');

  // ── Resolve skill (lazy, exits on bad config) ─────────────────────────────
  const getSkill = () => {
    if (!fs.existsSync(CONFIG_PATH)) {
      log.error('No configuration found — run: agentos onboard');
      process.exit(1);
    }
    const DahuaSkill = require('../../skills/dahua/index.js');
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return new DahuaSkill({ config });
  };

  // ── dahua list ────────────────────────────────────────────────────────────
  dahua
    .command('list')
    .description('List configured Dahua devices')
    .action(async () => {
      intro('📷 Dahua Devices');
      const s = spinner();
      s.start('Fetching device list…');
      try {
        const skill = getSkill();
        const res   = await skill.execute('dahua.device.list', {});
        const devices = Array.isArray(res) ? res : [res];
        s.stop(`${devices.length} device(s) found`);

        const lines = devices.map((d, i) =>
          `${String(i + 1).padStart(2)}. ${d.name || d.id || JSON.stringify(d)}`
        );
        note(lines.join('\n'), '📋 Device List');
        outro('Done.');
      } catch (e) {
        s.stop(`Failed: ${e.message}`);
        log.error(e.message);
      }
    });

  // ── dahua snapshot ────────────────────────────────────────────────────────
  dahua
    .command('snapshot')
    .description('Get snapshot URL or path')
    .option('-d, --device <id>', 'Device ID')
    .option('-c, --channel <n>', 'Channel number')
    .action(async (options) => {
      intro('📸 Dahua Snapshot');
      const s = spinner();
      s.start(`Fetching snapshot${options.device ? ` for device ${options.device}` : ''}…`);
      try {
        const skill = getSkill();
        const res   = await skill.execute('dahua.snapshot.get', {
          device:  options.device,
          channel: options.channel,
        });
        s.stop('Snapshot retrieved');
        note(
          typeof res === 'string'
            ? `URL/Path :  ${res}`
            : JSON.stringify(res, null, 2),
          '🖼️  Snapshot'
        );
        outro('Done.');
      } catch (e) {
        s.stop(`Failed: ${e.message}`);
        log.error(e.message);
      }
    });

  // ── dahua reboot ──────────────────────────────────────────────────────────
  dahua
    .command('reboot')
    .description('Reboot a Dahua device')
    .option('-d, --device <id>', 'Device ID')
    .option('--force', 'Skip confirmation prompt')
    .action(async (options) => {
      if (!options.force) {
        const target = options.device || 'all devices';
        const ok = await confirm({ message: `Reboot ${target}?`, initialValue: false });
        if (isCancel(ok) || !ok) { log.warn('Cancelled.'); return; }
      }

      const s = spinner();
      s.start(`Sending reboot command${options.device ? ` to ${options.device}` : ''}…`);
      try {
        const skill = getSkill();
        await skill.execute('dahua.system.reboot', { device: options.device });
        s.stop('Reboot command sent');
        outro('✓ Device is rebooting.');
      } catch (e) {
        s.stop(`Failed: ${e.message}`);
        log.error(e.message);
      }
    });
};
