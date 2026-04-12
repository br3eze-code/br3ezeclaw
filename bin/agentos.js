#!/usr/bin/env node

// ==========================================
// AGENTOS CLI ENTRY
// ==========================================

const { program } = require('commander');
const chalk = require('chalk');
const boxen = require('boxen');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config();

const dataPath = path.join(process.cwd(), 'data');
const sessionsPath = path.join(dataPath, 'sessions');
const skillsDataPath = path.join(dataPath, 'skills');

[sessionsPath, skillsDataPath].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Import commands
const gatewayCommand = require('../src/cli/commands/gateway');
const networkCommand = require('../src/cli/commands/network');
const usersCommand = require('../src/cli/commands/users');
const voucherCommand = require('../src/cli/commands/voucher');
const onboardCommand = require('../src/cli/commands/onboard');
const configCommand = require('../src/cli/commands/config');
const doctorCommand = require('../src/cli/commands/doctor');
const skillCommand = require('../src/cli/commands/skill');

program
  .name('agentos')
  .description('AgentOS OpenClaw - Domain-agnostic AI agent operating system')
  .version('2.0.0');

// Gateway command
program
  .command('gateway')
  .description('Start the AgentOS gateway (WebSocket + HTTP API)')
  .option('-d, --daemon', 'Run as background daemon')
  .option('-f, --force', 'Kill existing process before starting')
  .option('-p, --port <port>', 'Gateway port', process.env.GATEWAY_PORT || '3000')
  .action(gatewayCommand);

program
  .command('gateway:status')
  .description('Check gateway status')
  .action(() => gatewayCommand.status());

program
  .command('gateway:stop')
  .description('Stop the gateway daemon')
  .action(() => gatewayCommand.stop());

// Network commands
program
  .command('network')
  .alias('net')
  .description('Network diagnostic tools')
  .addCommand(
    program.createCommand('ping <host>')
      .description('Ping a host')
      .action(networkCommand.ping)
  )
  .addCommand(
    program.createCommand('scan')
      .description('Scan DHCP leases')
      .action(networkCommand.scan)
  )
  .addCommand(
    program.createCommand('firewall')
      .description('Show firewall rules')
      .action(networkCommand.firewall)
  )
  .addCommand(
    program.createCommand('traceroute <host>')
      .description('Traceroute to host')
      .action(networkCommand.traceroute)
  );

// User commands
program
  .command('users')
  .alias('user')
  .description('User management')
  .addCommand(
    program.createCommand('list')
      .option('-a, --all', 'Show all users including offline')
      .description('List active users')
      .action(usersCommand.list)
  )
  .addCommand(
    program.createCommand('kick <user>')
      .description('Disconnect a user')
      .action(usersCommand.kick)
  )
  .addCommand(
    program.createCommand('add <user>')
      .requiredOption('-p, --password <password>', 'User password')
      .option('-t, --time <time>', 'Session time limit')
      .description('Add a new user')
      .action(usersCommand.add)
  )
  .addCommand(
    program.createCommand('status <user>')
      .description('Check user online status')
      .action(usersCommand.status)
  );

// Voucher commands
program
  .command('voucher')
  .alias('v')
  .description('Voucher management')
  .addCommand(
    program.createCommand('create [plan]')
      .description('Create a voucher (1Day, 1Hour, etc)')
      .action(voucherCommand.create)
  )
  .addCommand(
    program.createCommand('list')
      .option('-l, --limit <n>', 'Number of vouchers', '10')
      .description('List recent vouchers')
      .action(voucherCommand.list)
  )
  .addCommand(
    program.createCommand('revoke <code>')
      .description('Revoke a voucher')
      .action(voucherCommand.revoke)
  )
  .addCommand(
    program.createCommand('stats')
      .description('Voucher statistics')
      .action(voucherCommand.stats)
  );

// Skill commands
program
  .command('skill')
  .description('Skill management')
  .addCommand(
    program.createCommand('list')
      .description('List installed skills')
      .action(skillCommand.list)
  )
  .addCommand(
    program.createCommand('install <path>')
      .description('Install a skill from path')
      .action(skillCommand.install)
  )
  .addCommand(
    program.createCommand('remove <name>')
      .description('Remove a skill')
      .action(skillCommand.remove)
  )
  .addCommand(
    program.createCommand('reload <name>')
      .description('Reload a skill')
      .action(skillCommand.reload)
  )
  .addCommand(
    program.createCommand('info <name>')
      .description('Show skill information')
      .action(skillCommand.info)
  );

// Config commands
program
  .command('config')
  .description('Configuration management')
  .addCommand(
    program.createCommand('get <path>')
      .description('Get configuration value')
      .action(configCommand.get)
  )
  .addCommand(
    program.createCommand('set <path> <value>')
      .description('Set configuration value')
      .action(configCommand.set)
  )
  .addCommand(
    program.createCommand('edit')
      .description('Open configuration in editor')
      .action(configCommand.edit)
  )
  .addCommand(
    program.createCommand('show')
      .description('Show all configuration')
      .action(configCommand.show)
  );

// Utility commands
program
  .command('onboard')
  .description('Interactive setup wizard')
  .action(onboardCommand);

program
  .command('doctor')
  .description('Health check and diagnostics')
  .option('-f, --fix', 'Attempt auto-repair')
  .action(doctorCommand);

program
  .command('status')
  .alias('s')
  .description('Quick system status')
  .action(async () => {
    const { Gateway } = require('../src/core/gateway');
    const gateway = new Gateway();
    await gateway.printStatus();
  });

// Parse arguments
program.parse();

// Show help if no command
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
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
  });

program
  .command('completion')
  .description('Generate shell completion script')
  .action(() => {
    const completionScript = fs.readFileSync(
      path.join(__dirname, '../scripts/completion.sh'),
      'utf8'
    );
    console.log(completionScript);
  });

// Add commands
require('../src/cli/commands/onboard')(program);
require('../src/cli/commands/gateway')(program);
require('../src/cli/commands/networks')(program);
require('../src/cli/commands/users')(program);
require('../src/cli/commands/voucher')(program);
require('../src/cli/commands/config')(program);
require('../src/cli/commands/doctor')(program);
require('../src/cli/commands/status')(program);
require('../src/cli/commands/dashboard')(program); 

// Help command customization
program.on('--help', () => {
  console.log('');
  console.log(chalk.cyan('Examples:'));
  console.log('  $ agentos onboard              Interactive setup wizard');
  console.log('  $ agentos gateway              Run WebSocket gateway (foreground)');
  console.log('  $ agentos gateway --daemon     Run as background service');
  console.log('  $ agentos network ping 8.8.8.8 Ping from router');
  console.log('  $ agentos users list           Show active hotspot users');
  console.log('  $ agentos voucher create 1h    Generate 1-hour voucher');
  console.log('  $ agentos dashboard            Show system dashboard');
  console.log('  $ agentos doctor               Health check & auto-fix');
  console.log('');
  console.log(chalk.gray(`Profile directory: ${getProfileDir()}`));
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
