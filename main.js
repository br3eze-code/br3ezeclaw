#!/usr/bin/env node
'use strict';

/**
 * AgentOS — Master Entry Point
 * Consolidates CLI and Daemon logic.
 */

const { program } = require('commander');
const _chalk = require('chalk');
const chalk = _chalk.default || _chalk;
const _boxen = require('boxen');
const boxen = _boxen.default || _boxen;
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config();

// ── Config & Brand ────────────────────────────────────────────────────────────
const { BRAND, CONFIG_PATH, STATE_PATH, getConfig } = require('./src/core/config');

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

// ── Ensure Data Directories ───────────────────────────────────────────────────
[
    path.join(process.cwd(), 'data', 'sessions'),
    path.join(process.cwd(), 'data', 'skills'),
    path.join(process.cwd(), 'logs'),
    STATE_PATH
].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── Banner ────────────────────────────────────────────────────────────────────
const showBanner = () => {
    if (!process.argv.includes('--no-banner') && !process.argv.includes('--json')) {
        try {
            console.log(boxen(
                `${chalk.cyan.bold(`${BRAND.emoji} ${BRAND.name} ${BRAND.version}`)}\n` +
                `${chalk.gray(BRAND.tagline)}`,
                { padding: 1, margin: 0, borderStyle: 'round', borderColor: 'cyan' }
            ));
        } catch (_) {
            console.log(`\n  ${BRAND.emoji} ${BRAND.name} ${BRAND.version} — ${BRAND.tagline}\n`);
        }
    }
};

// ── CLI Configuration ─────────────────────────────────────────────────────────
program
    .name('agentos')
    .description(`${BRAND.name} — Modular AI Agent Operating System`)
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

// ── Command Registration ──────────────────────────────────────────────────────
require('./src/cli/commands/onboard')(program);
require('./src/cli/commands/gateway')(program);
require('./src/cli/commands/networks')(program);
require('./src/cli/commands/users')(program);
require('./src/cli/commands/voucher')(program);
require('./src/cli/commands/config')(program);
require('./src/cli/commands/doctor')(program);
require('./src/cli/commands/status')(program);
require('./src/cli/commands/dashboard')(program);
require('./src/cli/commands/skill')(program);
require('./src/cli/commands/dahua')(program);
require('./src/cli/commands/wacli')(program);
require('./src/cli/commands/google')(program);
require('./src/cli/commands/update')(program);

// ── Logging Daemon ────────────────────────────────────────────────────────────
program
    .command('logs')
    .description('Start the standalone logging daemon (UDP 5001)')
    .action(() => {
        require('./src/cli/daemon/logs-daemon');
    });


// ── Diagnostics Command ───────────────────────────────────────────────────────
program
    .command('debug [mode]')
    .description('Perform system-wide or component diagnostics')
    .action(async (mode) => {
        showBanner();
        
        if (mode === 'telegram') {
            console.log(chalk.cyan('\n--- Telegram Channel Diagnostic ---\n'));
            const TelegramChannel = require('./src/core/channels/TelegramChannel');
            try {
                const bot = new TelegramChannel({
                    token: process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN
                });
                await bot.initialize();
                console.log(chalk.green('✔ Initialized successfully'));
                const me = await bot.bot.getMe();
                console.log(chalk.gray('  Bot Info: '), `@${me.username} (${me.first_name})`);
                process.exit(0);
            } catch (err) {
                console.error(chalk.red('✘ Initialization failed:'), err.message);
                process.exit(1);
            }
        }

        console.log(chalk.cyan('\n🩺 AgentOS System Diagnostics\n'));
        
        const { PROFILE_DIR, CONFIG_PATH } = global.AGENTOS;
        console.log(chalk.gray('  Profile:  '), chalk.white(PROFILE_DIR));
        console.log(chalk.gray('  Config:   '), fs.existsSync(CONFIG_PATH) ? chalk.green('Found') : chalk.red('Missing'));
        
        const envKeys = ['GEMINI_API_KEY', 'MIKROTIK_IP', 'FIREBASE_PROJECT_ID', 'TELEGRAM_BOT_TOKEN'];
        console.log(chalk.gray('\n  Environment:'));
        envKeys.forEach(k => {
            const val = process.env[k];
            console.log(`    ${chalk.gray(k.padEnd(20))}: ${val ? chalk.green('✓ Set') : chalk.yellow('○ Not Set')}`);
        });

        console.log(chalk.gray('\n  Running module diagnostics...'));
        try {
            // Trigger voucher debug if available
            console.log(chalk.gray('  - Vouchers: '));
            const { getDatabase } = require('./src/core/database');
            const db = await getDatabase();
            const stats = await db.getStats();
            console.log(chalk.green(`    ✓ ${stats.total} vouchers found (${stats.active} active)`));
        } catch (e) {
            console.log(chalk.red(`    ❌ Voucher check failed: ${e.message}`));
        }

        console.log(chalk.cyan('\n✨ Use "agentos status" for live connection checks.\n'));
    });

// ── Main Logic ────────────────────────────────────────────────────────────────
const run = async () => {
    // Helper to check if any known command is in argv
    const commands = program.commands.map(c => c.name());
    const hasCommand = process.argv.some(arg => commands.includes(arg));

    if (!hasCommand && !process.argv.includes('-h') && !process.argv.includes('--help')) {
        showBanner();
        console.log(chalk.yellow('! No command specified, defaulting to: gateway\n'));
        // Insert 'gateway' before any options but after node/script
        const newArgs = [...process.argv];
        newArgs.splice(2, 0, 'gateway');
        await program.parseAsync(newArgs);
    } else {
        if (!process.argv.includes('gateway')) showBanner();
        await program.parseAsync(process.argv);
    }

    // Centrally manage process exit for commands that should terminate.
    const daemonCommands = ['gateway', 'logs'];
    const currentCommand = program.args[0] || (process.argv.some(arg => daemonCommands.includes(arg)) ? 'gateway' : null);
    
    const isDashboard = currentCommand === 'dashboard';
    const isRefreshing = process.argv.includes('--refresh');
    
    const shouldExit = !daemonCommands.includes(currentCommand) && 
                      (!isDashboard || !isRefreshing);

    if (shouldExit) {
        // Set exit code and let the event loop drain naturally.
        // Calling process.exit(0) abruptly on Windows can trigger 
        // libuv assertion failures if handles are still closing.
        process.exitCode = 0;
    }
};

process.on('unhandledRejection', (reason, promise) => {
    const errorMsg = `\n✗ Unhandled Rejection at: ${promise} reason: ${reason}`;
    console.error(chalk.red(errorMsg));
    
    // Log to file if logger is available
    try {
        const { logger } = require('./src/core/logger');
        if (logger) logger.error('Unhandled Rejection', { reason, stack: reason?.stack });
    } catch (e) {
        // Fallback if logger is not ready
    }

    // Only exit if NOT in gateway mode, to keep the daemon running
    if (!process.argv.includes('gateway')) {
        process.exit(1);
    }
});

run().catch(err => {
    console.error(chalk.red('Fatal Error:'), err);
    process.exit(1);
});