// ==========================================
// AGENTOS STATUS COMMAND
// Quick system overview with clack prompts
// ==========================================

'use strict';

const fs   = require('fs');
const path = require('path');
const { intro, outro, spinner, note, log } = require('@clack/prompts');
const { getDatabase } = require('../../core/database');
const { costTracker } = require('../../core/cost-tracker');

module.exports = (program) => {
  program
    .command('status')
    .description('Show system status')
    .alias('s')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const { BRAND, CONFIG_PATH, STATE_PATH } = global.AGENTOS;

      const statusData = {
        agentos:      {},
        gateway:      {},
        router:       {},
        capabilities: { skills: 0, domains: 0 },
        costs:        costTracker.snapshot(),
        timestamp:    new Date().toISOString(),
      };

      try {
        // ── Config ──────────────────────────────────────────────
        if (fs.existsSync(CONFIG_PATH)) {
          const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
          statusData.agentos = {
            profile: global.AGENTOS.PROFILE_DIR,
            version: cfg.version,
            created: new Date(cfg.createdAt).toLocaleDateString(),
          };
        } else {
          log.warn('Not configured — run: agentos onboard');
          return;
        }

        // ── Gateway ─────────────────────────────────────────────
        const pidFile = `${STATE_PATH}/gateway.pid`;
        if (fs.existsSync(pidFile)) {
          try {
            const pid = fs.readFileSync(pidFile, 'utf8').trim();
            process.kill(parseInt(pid), 0);
            statusData.gateway = { status: 'running', pid: parseInt(pid) };
          } catch {
            statusData.gateway = { status: 'stale', error: 'PID file exists but process not running' };
          }
        } else {
          statusData.gateway = { status: 'stopped' };
        }

        // ── Channels ─────────────────────────────────────────────
        statusData.channels = {
          telegram: !!process.env.TELEGRAM_BOT_TOKEN || !!process.env.TELEGRAM_TOKEN,
          whatsapp: !!process.env.WHATSAPP_TOKEN,
          slack:    !!process.env.SLACK_BOT_TOKEN || !!process.env.SLACK_TOKEN,
          discord:  !!process.env.DISCORD_TOKEN,
        };

        // ── Capabilities ─────────────────────────────────────────
        try {
          const skillsPath = path.join(process.cwd(), 'src', 'skills');
          if (fs.existsSync(skillsPath))
            statusData.capabilities.skills = fs.readdirSync(skillsPath, { withFileTypes: true }).filter(d => d.isDirectory()).length;

          const domainsPath = path.join(process.cwd(), 'src', 'domains');
          if (fs.existsSync(domainsPath))
            statusData.capabilities.domains = fs.readdirSync(domainsPath, { withFileTypes: true }).filter(d => d.isDirectory()).length;
        } catch { /* ignore */ }

        // ── MikroTik ─────────────────────────────────────────────
        const s = spinner();
        s.start('Connecting to router…');
        let mikrotik;
        try {
          const { getMikroTikClient } = require('../../core/mikrotik');
          mikrotik = await getMikroTikClient();
          await mikrotik.connect();
          const stats = await mikrotik.getSystemStats();
          s.stop('Router telemetry collected');
          statusData.router = {
            status:  'connected',
            cpu:     `${stats['cpu-load'] || 0}%`,
            memory:  `${stats['memory-usage-percent'] || 0}%`,
            uptime:  stats['uptime'] || 'unknown',
            version: stats['version'] || 'unknown',
          };
        } catch (e) {
          s.stop(`Router unreachable: ${e.message}`);
          statusData.router = { status: 'disconnected', error: e.message };
        } finally {
          if (mikrotik) {
            try {
              const p = mikrotik.disconnect();
              if (p && p.catch) p.catch(() => {});
            } catch (e) {}
          }
        }

        // ── Vouchers ─────────────────────────────────────────────
        try {
          const db = await getDatabase();
          statusData.vouchers = await db.getStats();
        } catch (e) {
          statusData.vouchers = { error: e.message };
        }

        // ── Output ───────────────────────────────────────────────
        if (options.json) {
          console.log(JSON.stringify(statusData, null, 2));
        } else {
          renderStatus(statusData, BRAND);
        }

      } catch (error) {
        log.error(`Status failed: ${error.message}`);
        process.exit(1);
      }
    });
};

// ── Renderer ─────────────────────────────────────────────────────────────────

function renderStatus(data, brand) {
  intro(`${brand.emoji}  ${brand.name} Status`);

  // ── System Identity ──────────────────────────────────────────
  const identityLines = [
    `Profile :  ${data.agentos.profile || '(unknown)'}`,
    `Version :  ${data.agentos.version || '(unknown)'}`,
    `Created :  ${data.agentos.created || '—'}`,
    `Skills  :  ${data.capabilities.skills} loaded`,
    `Domains :  ${data.capabilities.domains} identified`,
  ];
  note(identityLines.join('\n'), '📦 System Identity');

  // ── Gateway & Router ─────────────────────────────────────────
  const gwStatus = data.gateway.status === 'running'
    ? `running (PID: ${data.gateway.pid})`
    : data.gateway.status;

  const routerLine = data.router.status === 'connected'
    ? `connected  CPU: ${data.router.cpu}  Memory: ${data.router.memory}`
    : `disconnected${data.router.error ? '  — ' + data.router.error : ''}`;

  const channels = [];
  if (data.channels?.telegram) channels.push('Telegram');
  if (data.channels?.whatsapp) channels.push('WhatsApp');
  if (data.channels?.slack) channels.push('Slack');
  if (data.channels?.discord) channels.push('Discord');
  const channelStr = channels.length ? channels.join(', ') : 'None configured';

  const infraLines = [
    `Gateway  :  ${gwStatus}`,
    `Router   :  ${routerLine}`,
    `Channels :  ${channelStr}`,
    ...(data.router.status === 'connected' ? [
      `Uptime   :  ${data.router.uptime}`,
      `RouterOS :  ${data.router.version}`,
    ] : []),
  ];
  note(infraLines.join('\n'), '🌐 Infrastructure');

  // ── Billing & AI ─────────────────────────────────────────────
  const billingLines = [];
  if (data.vouchers && !data.vouchers.error) {
    billingLines.push(
      `Vouchers:  ${data.vouchers.active} active / ${data.vouchers.total} total` +
      `  (${data.vouchers.used || 0} used, ${data.vouchers.expired || 0} expired)`
    );
  }
  if (data.costs) {
    const inT = data.costs.totalInputTokens || 0;
    const outT = data.costs.totalOutputTokens || 0;
    const total = inT + outT;
    billingLines.push(`AI Cost :  $${data.costs.estimatedUSD}  (${total} tokens)`);
    
    if (total > 0) {
      const width = 30;
      const inWidth = Math.round((inT / total) * width);
      const outWidth = width - inWidth;
      const bar = '█'.repeat(inWidth) + '▒'.repeat(outWidth);
      const inPct = ((inT / total) * 100).toFixed(1);
      const outPct = ((outT / total) * 100).toFixed(1);
      billingLines.push(`Usage   :  ${bar}`);
      billingLines.push(`           Input: ${inPct}%   Output: ${outPct}%`);
    } else {
      billingLines.push(`Usage   :  ` + '░'.repeat(30));
      billingLines.push(`           Input: 0%   Output: 0%`);
    }
  }
  if (billingLines.length) note(billingLines.join('\n'), '💰 Billing & AI');

  outro(`Type 'agentos --help' for available commands`);
}
