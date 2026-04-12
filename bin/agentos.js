#!/usr/bin/env node

// ==========================================
// AGENTOS CLI ENTRY POINT
// ==========================================

const { program } = require('commander');
const chalk = require('chalk');
const boxen = require('boxen');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Initialize globals first
require('../src/core/config');

// Brand constants
const { BRAND, CONFIG_PATH, STATE_PATH, PROFILE_DIR } = require('../src/core/config');

// Print banner
if (!process.argv.includes('--no-banner') && !process.argv.includes('--json')) {
    console.log(boxen(
        `${chalk.cyan.bold(`${BRAND.emoji} ${BRAND.name} ${BRAND.version}`)}\n` +
        `${chalk.gray(BRAND.tagline)}`,
        { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'cyan' }
    ));
}

// Determine profile directory
const getProfileDir = () => {
    const profile = process.env.AGENTOS_PROFILE || 'default';
    if (profile === 'default') {
        return path.join(os.homedir(), '.agentos');
    }
    return path.join(os.homedir(), `.agentos-${profile}`);
};

// Ensure profile directory exists
const ensureProfile = () => {
    const dir = getProfileDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
};


// Ensure state directory
if (!fs.existsSync(STATE_PATH)) {
    fs.mkdirSync(STATE_PATH, { recursive: true });
}

// Export globals for subcommands
global.AGENTOS = {
    BRAND,
    CONFIG_PATH,
    STATE_PATH,
    PROFILE_DIR: getProfileDir(),
    IS_DEV: process.argv.includes('--dev')
};


// Initialize Commander program
program
    .name('agentos')
    .description(`${BRAND.name} - Self-hosted network intelligence gateway`)
    .version(BRAND.version, '-V, --version', 'Output version number')
    .option('--dev', 'Development profile: isolate state under ~/.agentos-dev')
    .option('--profile <name>', 'Use named profile (isolates config/state)')
    .option('--log-level <level>', 'Global log level (silent|fatal|error|warn|info|debug|trace)', 'info')
    .option('--no-color', 'Disable ANSI colors')
    .option('--json', 'Output JSON for programmatic use')
    .configureOutput({
        writeErr: (str) => process.stdout.write(str),
        getOutHelpWidth: () => 100,
        getErrHelpWidth: () => 100
    })
    .command('completion')
    .description('Generate shell completion script')
    .action(() => {
    const completionScript = fs.readFileSync(
      path.join(__dirname, '../scripts/completion.sh'), 
      'utf8'
    );
    console.log(completionScript);
    

// Add commands
require('../src/cli/commands/onboard')(program);
require('../src/cli/commands/gateway')(program);
require('../src/cli/commands/networks')(program);
require('../src/cli/commands/users')(program);
require('../src/cli/commands/voucher')(program);
require('../src/cli/commands/config')(program);
require('../src/cli/commands/doctor')(program);
require('../src/cli/commands/status')(program);

// Help command customization
program.on('--help', () => {
    console.log('');
    console.log(chalk.cyan('Examples:'));
    console.log('  $ agentos onboard              Interactive setup wizard');
    console.log('  $ agentos gateway              Run WebSocket gateway (foreground)');
    console.log('  $ agentos gateway --daemon     Run as background service');
    console.log('  $ agentos network ping 8.8.8.8  Ping from router');
    console.log('  $ agentos users list            Show active hotspot users');
    console.log('  $ agentos voucher create 1h     Generate 1-hour voucher');
    console.log('  $ agentos doctor                Health check & auto-fix');
    console.log('');
    console.log(chalk.gray(`Profile directory: ${getProfileDir()}`));
    console.log(chalk.gray(`Profile: ${PROFILE_DIR}`));
    console.log(chalk.gray('Docs: https://docs.agentos.ai/cli'));
});

// Error handlers
process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('Error:'), reason);
  process.exit(1);
});

// Parse arguments
program.parse();

// If no command provided, show help
if (!process.argv.slice(2).length) {
    program.outputHelp();
}
