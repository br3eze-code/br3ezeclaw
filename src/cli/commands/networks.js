// ==========================================
// AGENTOS NETWORK COMMAND
// Network diagnostics — @clack/prompts edition
// ==========================================

'use strict';

const { intro, outro, spinner, note, log, confirm, isCancel } = require('@clack/prompts');

module.exports = (program) => {
  const network = program
    .command('network')
    .description('Network diagnostics and RouterOS tools')
    .alias('net');

  // ── network ping ──────────────────────────────────────────────────────────
  network
    .command('ping <host>')
    .description('Ping test from router')
    .option('--count, -c <n>', 'Number of pings', '4')
    .action(async (host, options) => {
      const s = spinner();
      s.start(`Pinging ${host}…`);
      try {
        const { getMikroTikClient } = require('../../core/mikrotik');
        const mikrotik = await getMikroTikClient();
        const result   = await mikrotik.ping(host, parseInt(options.count) || 4);
        s.stop(`Ping complete — ${result.filter(r => r.received > 0).length}/${result.length} replies`);

        const lines = result.map((r, i) => {
          const ok = r.received > 0;
          return `${ok ? '●' : '○'} Hop ${String(i + 1).padStart(2)}: ${r.host}  ${r.time || 'timeout'}`;
        });
        note(lines.join('\n'), `📡 Ping: ${host}`);
        outro('Done.');
      } catch (error) {
        log.error(`Ping failed: ${error.message}`);
      }
    });

  // ── network scan ──────────────────────────────────────────────────────────
  network
    .command('scan')
    .description('Scan for connected devices (DHCP leases)')
    .action(async () => {
      const s = spinner();
      s.start('Scanning DHCP leases…');
      try {
        const { getMikroTikClient } = require('../../core/mikrotik');
        const mikrotik = await getMikroTikClient();
        const leases   = await mikrotik.getDhcpLeases();
        s.stop(`${leases.length} device(s) found`);

        if (!leases.length) { log.warn('No DHCP leases.'); return; }

        const lines = leases.map((l, i) => {
          const status = l.status === 'bound' ? '●' : '○';
          return `${status} ${String(i + 1).padStart(2)}. ${(l.hostName || 'Unknown').padEnd(22)}  ${l.address.padEnd(16)}  ${l.macAddress}`;
        });
        note(lines.join('\n'), `📋 Connected Devices (${leases.length})`);
        outro('Done.');
      } catch (error) {
        log.error(`Scan failed: ${error.message}`);
      }
    });

  // ── network firewall ──────────────────────────────────────────────────────
  network
    .command('firewall')
    .description('Show firewall rules')
    .option('--type <type>', 'Rule type: filter | nat | mangle', 'filter')
    .action(async (options) => {
      const s = spinner();
      s.start(`Fetching ${options.type} rules…`);
      try {
        const { getMikroTikClient } = require('../../core/mikrotik');
        const mikrotik = await getMikroTikClient();
        const rules    = await mikrotik.getFirewallRules(options.type);
        s.stop(`${rules.length} ${options.type} rule(s)`);

        const visible = rules.slice(0, 15);
        const lines = visible.map((r, i) => {
          const action = (r.action || 'unknown').toUpperCase().padEnd(8);
          return `${String(i + 1).padStart(2)}. [${r.chain}] ${action}  ${r.comment || ''}`;
        });
        if (rules.length > 15) lines.push(`   … and ${rules.length - 15} more rules`);

        note(lines.join('\n'), `🔥 Firewall — ${options.type} (${rules.length})`);
        outro('Done.');
      } catch (error) {
        log.error(`Failed: ${error.message}`);
      }
    });

  // ── network block ─────────────────────────────────────────────────────────
  network
    .command('block <target>')
    .description('Block an IP or MAC address')
    .option('--reason <reason>', 'Block reason', 'Manual block via CLI')
    .action(async (target, options) => {
      const s = spinner();
      s.start(`Blocking ${target}…`);
      try {
        const { getMikroTikClient } = require('../../core/mikrotik');
        const mikrotik = await getMikroTikClient();
        await mikrotik.addToBlockList(target, options.reason);
        s.stop(`${target} blocked`);
        note([`Target :  ${target}`, `Reason :  ${options.reason}`].join('\n'), '🚫 Blocked');
        outro('Done.');
      } catch (error) {
        log.error(`Failed: ${error.message}`);
      }
    });

  // ── network unblock ───────────────────────────────────────────────────────
  network
    .command('unblock <target>')
    .description('Unblock an IP or MAC address')
    .action(async (target) => {
      const ok = await confirm({ message: `Unblock ${target}?` });
      if (isCancel(ok) || !ok) { log.warn('Cancelled.'); return; }

      const s = spinner();
      s.start(`Unblocking ${target}…`);
      try {
        const { getMikroTikClient } = require('../../core/mikrotik');
        const mikrotik = await getMikroTikClient();
        await mikrotik.removeFromBlockList(target);
        s.stop(`${target} unblocked`);
        outro('Done.');
      } catch (error) {
        log.error(`Failed: ${error.message}`);
      }
    });

  // ── network sync-profiles ─────────────────────────────────────────────────
  network
    .command('sync-profiles')
    .description('Sync hotspot user profiles from MikroTik → database')
    .action(async () => {
      intro('🔄 Profile Sync');
      const s = spinner();
      s.start('Fetching profiles from MikroTik…');

      try {
        const { getMikroTikClient }  = require('../../core/mikrotik');
        const { getDatabase }        = require('../../core/database');

        const mikrotik = await getMikroTikClient();
        const profiles = await mikrotik.getHotspotProfiles();
        s.stop(`${profiles.length} profile(s) found`);

        s.start('Syncing to database…');
        const db = await getDatabase();

        if (!db.db) {
          s.stop('Firebase not connected');
          log.error('Sync requires Firebase. Check your credentials.');
          return;
        }

        let created = 0, existing = 0;
        for (const p of profiles) {
          if (p.name === 'default') continue;
          const planId  = db.hashPlanId(p.name);
          const planRef = db.db.collection('plans').doc(planId);
          const planDoc = await planRef.get();

          if (!planDoc.exists) {
            await planRef.set({
              name:          p.name,
              mikrotikProfile: p.name,
              active:        true,
              price:         0,
              durationValue: 1,
              durationUnit:  'days',
              deviceLimit:   1,
              createdAt:     new Date().toISOString(),
              syncedFromRouter: true,
            });
            created++;
          } else {
            existing++;
          }
        }

        s.stop(`Sync complete — ${created} new, ${existing} already existed`);
        note(
          [
            `Total profiles :  ${profiles.length}`,
            `New plans      :  ${created}`,
            `Already exist  :  ${existing}`,
            `IDs use 16-char SHA-256 hash of profile name`,
          ].join('\n'),
          '✅ Sync Results'
        );
        outro('Profile sync complete.');
      } catch (error) {
        log.error(`Sync failed: ${error.message}`);
      }
    });
};
