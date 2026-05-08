// ==========================================
// AGENTOS DASHBOARD COMMAND
// Comprehensive system overview — @clack/prompts edition
// ==========================================

'use strict';

const { getManager: getMikroTikManager } = require('../../core/mikrotik');

module.exports = (program) => {
  program
    .command('dashboard')
    .description('Show comprehensive system dashboard')
    .option('--refresh <seconds>', 'Auto-refresh interval (seconds)')
    .action(async (options) => {
      const render = async () => {
        // @clack/prompts is ESM-only — must be dynamically imported
        const { intro, outro, spinner, note, log } = await import('@clack/prompts');
        console.clear();
        intro('📊 AgentOS Dashboard');

        const s = spinner();
        s.start('Loading telemetry…');

        try {
          const mikrotik = getMikroTikManager();
          const [stats, activeUsers, allUsers, interfaces, dbStats] = await Promise.all([
            mikrotik.getSystemStats(),
            mikrotik.getActiveUsers(),
            mikrotik.getAllHotspotUsers(),
            mikrotik.getInterfaces(),
            (async () => {
              const { getDatabase } = require('../../core/database');
              const db = await getDatabase();
              return db.getStats();
            })()
          ]);

          s.stop('Telemetry loaded');

          // ── System Health ──────────────────────────────────────────────
          const cpu    = stats['cpu-load']             || 0;
          const mem    = stats['memory-usage-percent'] || 0;
          note(
            [
              `CPU Load :  ${progressBar(cpu)}  ${cpu}%`,
              `Memory   :  ${progressBar(mem)}  ${mem}%`,
              `Uptime   :  ${stats.uptime    || 'N/A'}`,
              `RouterOS :  v${stats.version  || 'N/A'} (${stats['architecture-name'] || 'N/A'})`,
              `Board    :  ${stats['board-name'] || 'N/A'}`,
            ].join('\n'),
            '🖥️  System Health'
          );

          // ── User Activity ──────────────────────────────────────────────
          const disabled = allUsers.filter(u => u.disabled === 'yes').length;
          note(
            [
              `Active Sessions :  ${activeUsers.length}`,
              `Total Users     :  ${allUsers.length}`,
              `Disabled        :  ${disabled}`,
            ].join('\n'),
            '👥 User Activity'
          );

          // ── Active Connections (top 5) ─────────────────────────────────
          if (activeUsers.length > 0) {
            const lines = activeUsers.slice(0, 5).map((u, i) => {
              const dataIn  = formatBytes(u['bytes-in']  || 0);
              const dataOut = formatBytes(u['bytes-out'] || 0);
              return [
                `${String(i + 1).padStart(2)}. ${u.user}`,
                `    IP: ${u.address}  MAC: ${u['mac-address']}`,
                `    Uptime: ${u.uptime}  ↓${dataIn} ↑${dataOut}`,
              ].join('\n');
            });
            if (activeUsers.length > 5)
              lines.push(`   … and ${activeUsers.length - 5} more sessions`);
            note(lines.join('\n'), '🔌 Active Connections');
          }

          // ── Interfaces ─────────────────────────────────────────────────
          const ifLines = interfaces.slice(0, 6).map(iface => {
            const dot = iface.running === 'true' ? '●' : '○';
            return `${dot} ${iface.name}  (${iface.type})`;
          });
          note(ifLines.join('\n'), '🌐 Interfaces');

          // ── Vouchers ───────────────────────────────────────────────────
          if (dbStats) {
            note(
              [
                `Total   :  ${dbStats.total}`,
                `Active  :  ${dbStats.active}`,
                `Used    :  ${dbStats.used}`,
                `Expired :  ${dbStats.expired}`,
              ].join('\n'),
              '🎫 Vouchers'
            );
          }

          outro(`Last updated: ${new Date().toLocaleTimeString()}${options.refresh ? '  (auto-refresh active)' : ''}`);

        } catch (error) {
          s.stop(`Error: ${error.message}`);
          log.error(error.message);
        }
      };

      // Initial render
      await render();

      // Auto-refresh
      if (options.refresh) {
        const interval = parseInt(options.refresh) * 1000;
        log.info(`Auto-refreshing every ${options.refresh}s — press Ctrl+C to exit`);
        setInterval(render, interval);
      }
    });
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function progressBar(pct, width = 20) {
  const filled = Math.round(Math.min(pct, 100) / 100 * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
