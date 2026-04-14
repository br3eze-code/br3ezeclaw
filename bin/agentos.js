#!/usr/bin/env node
'use strict';

// ==========================================
// AGENTOS CLI ENTRY — UNIFIED BOOT
// ==========================================

const { program } = require('commander');
const _chalk  = require('chalk');
const chalk   = _chalk.default || _chalk;
const _boxen  = require('boxen');
const boxen   = _boxen.default || _boxen;
const fs      = require('fs');
const path    = require('path');
const os      = require('os');

// Load env before anything else
require('dotenv').config();

// ── Config ────────────────────────────────────────────────────────────────────
const { BRAND, CONFIG_PATH, STATE_PATH } = require('../src/core/config');

// ── Global surface for sub-commands ──────────────────────────────────────────
function getProfileDir() {
  const profile = process.env.AGENTOS_PROFILE ||
    (process.argv.includes('--dev') ? 'dev' : 'default');
  if (profile === 'default') return path.join(os.homedir(), '.agentos');
  return path.join(os.homedir(), `.agentos-${profile}`);
}

global.AGENTOS = {
  BRAND,
  CONFIG_PATH,
  STATE_PATH,
  PROFILE_DIR: getProfileDir(),
  IS_DEV: process.argv.includes('--dev')
};

// ── Ensure data dirs ──────────────────────────────────────────────────────────
[
  path.join(process.cwd(), 'data', 'sessions'),
  path.join(process.cwd(), 'data', 'skills'),
  STATE_PATH
].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── Banner ────────────────────────────────────────────────────────────────────
if (!process.argv.includes('--no-banner') && !process.argv.includes('--json')) {
  try {
    console.log(boxen(
      `${chalk.cyan.bold(`${BRAND.emoji} ${BRAND.name} ${BRAND.version}`)}\n` +
      `${chalk.gray(BRAND.tagline)}`,
      { padding: 1, margin: 0, borderStyle: 'round', borderColor: 'cyan' }
    ));
  } catch (_) {
    // Fallback plain banner if chalk/boxen fail in restricted environments
    console.log(`\n  ${BRAND.emoji} ${BRAND.name} ${BRAND.version} — ${BRAND.tagline}\n`);
  }
}

// ── Program metadata ──────────────────────────────────────────────────────────
program
  .name('agentos')
  .description(`${BRAND.name} — Domain-agnostic AI agent operating system`)
  .version(BRAND.version, '-V, --version', 'Output version number')
  .option('--dev',               'Use dev profile (~/.agentos-dev)')
  .option('--profile <name>',    'Named profile (isolates config/state)')
  .option('--log-level <level>', 'Log level: silent|error|warn|info|debug', 'info')
  .option('--no-color',          'Disable ANSI colors')
  .option('--json',              'Machine-readable JSON output')
  .option('--no-banner',         'Suppress startup banner')
  .configureOutput({
    writeErr: str => process.stdout.write(str),
    getOutHelpWidth:  () => 100,
    getErrHelpWidth:  () => 100
  });

// ── Register all commands (each module is a (program) => {} factory) ──────────
require('../src/cli/commands/onboard')(program);
require('../src/cli/commands/gateway')(program);
require('../src/cli/commands/networks')(program);
require('../src/cli/commands/users')(program);
require('../src/cli/commands/voucher')(program);
require('../src/cli/commands/config')(program);
require('../src/cli/commands/doctor')(program);
require('../src/cli/commands/status')(program);
require('../src/cli/commands/dashboard')(program);
require('../src/cli/commands/skill')(program);

// ── Help footer ───────────────────────────────────────────────────────────────
program.on('--help', () => {
  console.log('');
  console.log(chalk.cyan('Examples:'));
  console.log('  $ agentos onboard              Interactive setup wizard');
  console.log('  $ agentos gateway              Run WebSocket gateway');
  console.log('  $ agentos gateway --daemon     Run as background service');
  console.log('  $ agentos network ping 8.8.8.8 Ping from router');
  console.log('  $ agentos users list           Active hotspot users');
  console.log('  $ agentos voucher create 1h    Generate 1-hour voucher');
  console.log('  $ agentos dashboard            System dashboard');
  console.log('  $ agentos doctor               Health check & auto-fix');
  console.log('  $ agentos skill list           Show available skills');
  console.log('');
  console.log(chalk.gray(`Profile: ${getProfileDir()}`));
  console.log(chalk.gray('Docs:    https://docs.agentos.ai/cli'));
});

// ── Error handler ─────────────────────────────────────────────────────────────
process.on('unhandledRejection', reason => {
  console.error(chalk.red('\n✗ Unhandled error:'), reason);
  process.exit(1);
});

// ── Parse ─────────────────────────────────────────────────────────────────────
program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
