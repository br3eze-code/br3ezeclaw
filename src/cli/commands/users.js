// ==========================================
// AGENTOS USERS COMMAND
// Hotspot user management — @clack/prompts edition
// ==========================================

'use strict';

const { intro, outro, spinner, note, log, confirm, isCancel } = require('@clack/prompts');
const { getMikroTikClient } = require('../../core/mikrotik');

module.exports = (program) => {
  const users = program
    .command('users')
    .description('Manage hotspot users')
    .alias('user');

  // ── users list ────────────────────────────────────────────────────────────
  users
    .command('list')
    .description('List active hotspot users')
    .option('--all, -a', 'Show all users (not just active)')
    .option('--limit, -l <n>', 'Limit results', '20')
    .action(async (options) => {
      const s = spinner();
      s.start(options.all ? 'Fetching all hotspot users…' : 'Fetching active sessions…');

      try {
        const mikrotik = await getMikroTikClient();
        const limit = parseInt(options.limit) || 20;

        if (options.all) {
          const all = await mikrotik.getAllHotspotUsers();
          s.stop(`${all.length} users found`);

          if (!all.length) { log.warn('No hotspot users configured.'); return; }

          const lines = all.slice(0, limit).map((u, i) => {
            const status = u.disabled === 'yes' ? '🔴 disabled' : '🟢 enabled ';
            return `${String(i + 1).padStart(2)}. ${status}  ${(u.name || '').padEnd(18)}  ${u.profile || 'default'}`;
          });
          if (all.length > limit) lines.push(`   … and ${all.length - limit} more`);

          note(lines.join('\n'), `📋 All Hotspot Users (${all.length})`);
        } else {
          const active = await mikrotik.getActiveUsers();
          s.stop(`${active.length} active session(s)`);

          if (!active.length) { log.warn('No active sessions.'); return; }

          const lines = active.slice(0, limit).map((u, i) => {
            const dataIn  = formatBytes(u['bytes-in']  || 0);
            const dataOut = formatBytes(u['bytes-out'] || 0);
            return [
              `${String(i + 1).padStart(2)}. ${(u.user || '').padEnd(18)}  ${u.address || ''}`,
              `    MAC: ${u['mac-address'] || '—'}  Uptime: ${u.uptime || '—'}  ↓${dataIn} ↑${dataOut}`,
            ].join('\n');
          });

          note(lines.join('\n'), `👥 Active Sessions (${active.length})`);
        }

        outro('Done.');
      } catch (error) {
        log.error(`Failed: ${error.message}`);
      }
    });

  // ── users kick ────────────────────────────────────────────────────────────
  users
    .command('kick <username>')
    .description('Disconnect an active user')
    .action(async (username) => {
      const s = spinner();
      s.start(`Kicking ${username}…`);
      try {
        const mikrotik = await getMikroTikClient();
        const kicked = await mikrotik.kickUser(username);
        if (kicked) {
          s.stop(`${username} disconnected`);
          outro(`✓ ${username} kicked.`);
        } else {
          s.stop(`${username} not found in active sessions`);
          log.warn(`User "${username}" is not currently active.`);
        }
      } catch (error) {
        log.error(`Failed: ${error.message}`);
      }
    });

  // ── users add ─────────────────────────────────────────────────────────────
  users
    .command('add <username> [password]')
    .description('Add a hotspot user')
    .option('--profile <profile>', 'User profile / plan', 'default')
    .action(async (username, password, options) => {
      const pass = password || username;
      const s = spinner();
      s.start(`Creating user "${username}" (profile: ${options.profile})…`);
      try {
        const mikrotik = await getMikroTikClient();
        await mikrotik.addHotspotUser(username, pass, options.profile);
        s.stop(`User "${username}" created`);
        note(
          [`Username :  ${username}`, `Profile  :  ${options.profile}`].join('\n'),
          '✅ User Added'
        );
        outro('Done.');
      } catch (error) {
        log.error(`Failed: ${error.message}`);
      }
    });

  // ── users remove ──────────────────────────────────────────────────────────
  users
    .command('remove <username>')
    .description('Remove a hotspot user')
    .option('--force, -f', 'Force removal even if currently active')
    .action(async (username, options) => {
      try {
        const mikrotik = await getMikroTikClient();

        if (!options.force) {
          const active = await mikrotik.getUserStatus(username);
          if (active) {
            const ok = await confirm({
              message: `${username} is currently active. Remove anyway?`,
              initialValue: false,
            });
            if (isCancel(ok) || !ok) { log.warn('Cancelled.'); return; }
          }
        }

        const s = spinner();
        s.start(`Removing "${username}"…`);
        await mikrotik.removeHotspotUser(username);
        s.stop(`"${username}" removed`);
        outro('Done.');
      } catch (error) {
        log.error(`Failed: ${error.message}`);
      }
    });

  // ── users status ──────────────────────────────────────────────────────────
  users
    .command('status <username>')
    .description('Check user connection status')
    .action(async (username) => {
      const s = spinner();
      s.start(`Looking up ${username}…`);
      try {
        const mikrotik = await getMikroTikClient();
        const status = await mikrotik.getUserStatus(username);
        s.stop(status ? `${username} is ONLINE` : `${username} is OFFLINE`);

        if (status) {
          note(
            [
              `User    :  ${username}`,
              `IP      :  ${status.address}`,
              `MAC     :  ${status['mac-address']}`,
              `Uptime  :  ${status.uptime}`,
              `Data    :  ↓${formatBytes(status['bytes-in'] || 0)}  ↑${formatBytes(status['bytes-out'] || 0)}`,
            ].join('\n'),
            '🟢 Online Session'
          );
        } else {
          log.warn(`${username} is offline.`);
        }
        outro('Done.');
      } catch (error) {
        log.error(`Failed: ${error.message}`);
      }
    });

  // ── users transfer ────────────────────────────────────────────────────────
  users
    .command('transfer <from> <to> <amount>')
    .description('Transfer credits between users (P2P)')
    .action(async (from, to, amount) => {
      const s = spinner();
      s.start(`Transferring ${amount} credits  ${from} → ${to}…`);
      try {
        const { getDatabase } = require('../../core/database');
        const db = await getDatabase();
        await db.p2pTransfer(from, to, parseFloat(amount));
        s.stop('Transfer complete');
        note(
          [`From   :  ${from}`, `To     :  ${to}`, `Amount :  ${amount} credits`].join('\n'),
          '💸 Transfer Complete'
        );
        outro('Done.');
      } catch (error) {
        log.error(`Transfer failed: ${error.message}`);
      }
    });
};

// ── Utility ───────────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
