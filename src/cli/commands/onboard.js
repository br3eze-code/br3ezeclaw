// ==========================================
// AGENTOS ONBOARD COMMAND
// Domain-agnostic interactive setup wizard
// ==========================================

const _inquirer = require('inquirer');
const inquirer  = _inquirer.default || _inquirer;
const _chalk    = require('chalk');
const chalk     = _chalk.default || _chalk;
const _ora      = require('ora');
const ora       = _ora.default || _ora;
const fs       = require('fs');
const crypto   = require('crypto');

// Domain catalogue  ─────────────────────────────────────────────────────────
const DOMAIN_CATALOGUE = {
  mikrotik: {
    label: 'MikroTik Network Management (hotspot, vouchers, firewall)',
    requiresAdapter: true,
    adapterKey: 'mikrotik'
  },
  linux: {
    label: 'Linux Server Management (SSH, services, monitoring)',
    requiresAdapter: false
  },
  cloud: {
    label: 'Cloud Infrastructure (AWS / GCP / Azure)',
    requiresAdapter: false
  },
  iot: {
    label: 'IoT / Edge Device Management (MQTT, sensors)',
    requiresAdapter: false
  },
  general: {
    label: 'General AI Assistant (no specific infrastructure)',
    requiresAdapter: false
  },
  custom: {
    label: 'Custom / Skip (configure manually later)',
    requiresAdapter: false
  }
};

// ── Domain-specific adapter prompts ─────────────────────────────────────────

async function collectMikroTikConfig() {
  const { testMikroTikConnection } = require('../../core/mikrotik');

  console.log(chalk.cyan('\n📡 MikroTik Router Configuration\n'));

  const cfg = await inquirer.prompt([
    {
      type: 'input',
      name: 'ip',
      message: 'Router IP address:',
      default: '192.168.88.1',
      validate: v => /^\d+\.\d+\.\d+\.\d+$/.test(v) || 'Invalid IP format'
    },
    {
      type: 'input',
      name: 'user',
      message: 'API Username:',
      default: 'admin'
    },
    {
      type: 'password',
      name: 'pass',
      message: 'API Password:',
      mask: '*',
      validate: v => v.length > 0 || 'Password required'
    },
    {
      type: 'number',
      name: 'port',
      message: 'API Port:',
      default: 8728
    }
  ]);

  const spinner = ora('Testing MikroTik connection…').start();
  try {
    await testMikroTikConnection(cfg);
    spinner.succeed(chalk.green('✓ MikroTik connected'));
  } catch (err) {
    spinner.fail(chalk.red(`✗ Connection failed: ${err.message}`));
    const { continueAnyway } = await inquirer.prompt([{
      type: 'confirm',
      name: 'continueAnyway',
      message: 'Continue setup anyway?',
      default: true
    }]);
    if (!continueAnyway) throw new Error('Setup cancelled by user.');
  }

  return cfg;
}

async function collectHotspotPlans() {
  console.log(chalk.cyan('\n📋 Hotspot Plans\n'));
  const plans = [];
  let addMore = true;

  while (addMore) {
    const plan = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Plan name (e.g. 1hour, 1day):',
        validate: v => /^[a-zA-Z0-9]+$/.test(v) || 'Alphanumeric only'
      },
      { type: 'input',  name: 'duration',  message: 'Duration (e.g. 1h, 24h, 7d):', default: '1h' },
      { type: 'input',  name: 'rateLimit', message: 'Rate limit (e.g. 2M/2M):',     default: '2M/2M' },
      { type: 'number', name: 'price',     message: 'Price (local currency units):', default: 10 }
    ]);

    plans.push(plan);

    const { more } = await inquirer.prompt([{
      type: 'confirm',
      name: 'more',
      message: 'Add another plan?',
      default: plans.length < 3
    }]);
    addMore = more;
  }

  return plans;
}

// ── Main wizard ──────────────────────────────────────────────────────────────

module.exports = (program) => {
  program
    .command('onboard')
    .description('Interactive domain-agnostic setup wizard')
    .option('--reset', 'Overwrite existing configuration')
    .action(async (options) => {
      const { BRAND, CONFIG_PATH } = global.AGENTOS;

      console.log(chalk.cyan(`\n🚀  Welcome to ${BRAND.name} Setup!\n`));
      console.log(chalk.gray('This wizard configures your agent gateway for any domain.\n'));

      // ── Guard: existing config ─────────────────────────────────────────────
      if (fs.existsSync(CONFIG_PATH) && !options.reset) {
        const { overwrite } = await inquirer.prompt([{
          type: 'confirm',
          name: 'overwrite',
          message: 'Configuration already exists. Re-run setup?',
          default: false
        }]);
        if (!overwrite) {
          console.log(chalk.yellow('\nSetup cancelled. Use --reset to force.'));
          return;
        }
      }

      // ── Step 1: Pick domain ────────────────────────────────────────────────
      console.log(chalk.cyan('\n🌐 Step 1: Choose Your Domain\n'));

      const { selectedDomains } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selectedDomains',
        message: 'Select one or more domains to manage (Space to select):',
        choices: Object.entries(DOMAIN_CATALOGUE).map(([key, val]) => ({
          name: val.label,
          value: key
        })),
        validate: v => v.length > 0 || 'Select at least one domain'
      }]);

      // ── Step 2: Domain-specific adapter config ────────────────────────────
      const adapters = {};

      if (selectedDomains.includes('mikrotik')) {
        adapters.mikrotik = await collectMikroTikConfig();
      }

      // placeholder for future adapters (SSH, cloud, MQTT)
      for (const domain of selectedDomains.filter(d => d !== 'mikrotik' && d !== 'general' && d !== 'custom')) {
        console.log(chalk.yellow(`\n⚡ ${DOMAIN_CATALOGUE[domain].label}`));
        console.log(chalk.gray('  → Adapter to be configured via: agentos config set\n'));
      }

      // ── Step 3: Telegram (optional for all domains) ───────────────────────
      console.log(chalk.cyan('\n🤖 Step 2: Telegram Bot (optional)\n'));

      const { wantsTelegram } = await inquirer.prompt([{
        type: 'confirm',
        name: 'wantsTelegram',
        message: 'Configure Telegram bot integration?',
        default: selectedDomains.includes('mikrotik')
      }]);

      let telegramConfig = { token: '', allowedChats: [] };

      if (wantsTelegram) {
        telegramConfig = await inquirer.prompt([
          {
            type: 'input',
            name: 'token',
            message: 'Bot Token (from @BotFather):',
            validate: v => v.includes(':') || 'Invalid token format'
          },
          {
            type: 'input',
            name: 'allowedChats',
            message: 'Allowed Chat IDs (comma-separated, blank = all):',
            filter: v => v.split(',').map(s => s.trim()).filter(Boolean)
          }
        ]);
      }

      // ── Step 4: AI Provider ───────────────────────────────────────────────
      console.log(chalk.cyan('\n🧠 Step 3: AI Provider\n'));

      const { aiProvider } = await inquirer.prompt([{
        type: 'list',
        name: 'aiProvider',
        message: 'Primary AI provider:',
        choices: [
          { name: 'Google Gemini (recommended)', value: 'gemini' },
          { name: 'OpenAI (GPT-4o)',             value: 'openai' },
          { name: 'Anthropic (Claude)',           value: 'anthropic' },
          { name: 'None / Bring Your Own',       value: 'none' }
        ]
      }]);

      let aiKey = '';
      if (aiProvider !== 'none') {
        const keyName = { gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' }[aiProvider];
        const envKey  = process.env[keyName];
        if (envKey) {
          console.log(chalk.green(`  ✓ Using ${keyName} from environment`));
          aiKey = envKey;
        } else {
          const { enteredKey } = await inquirer.prompt([{
            type: 'password',
            name: 'enteredKey',
            message: `${aiProvider} API key:`,
            mask: '*'
          }]);
          aiKey = enteredKey;
        }
      }

      // ── Step 5: Gateway ───────────────────────────────────────────────────
      console.log(chalk.cyan('\n🌐 Step 4: Agent Gateway\n'));

      const gatewayConfig = await inquirer.prompt([
        { type: 'number',  name: 'port',      message: 'WebSocket port:', default: 19876 },
        { type: 'confirm', name: 'autostart', message: 'Auto-start on boot (PM2)?', default: true }
      ]);

      // ── Step 6: Hotspot plans (MikroTik only) ────────────────────────────
      let plans = [];
      if (selectedDomains.includes('mikrotik')) {
        plans = await collectHotspotPlans();
      }

      // ── Build & save config ───────────────────────────────────────────────
      const existingToken = fs.existsSync(CONFIG_PATH)
        ? (JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))?.gateway?.token || null)
        : null;

      const config = {
        name:      BRAND.name,
        version:   BRAND.version,
        createdAt: new Date().toISOString(),
        domains:   selectedDomains,
        adapters,
        telegram:  telegramConfig,
        ai: {
          provider: aiProvider,
          key:      aiKey
        },
        gateway: {
          ...gatewayConfig,
          host:  '127.0.0.1',
          token: existingToken || process.env.AGENTOS_GATEWAY_TOKEN || crypto.randomBytes(32).toString('hex')
        },
        plans,
        features: {
          vouchers:     selectedDomains.includes('mikrotik'),
          telegramBot:  wantsTelegram,
          webDashboard: true,
          websocketApi: true
        }
      };

      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

      // ── Write .env skeleton if not present ────────────────────────────────
      const envPath = path.join(process.cwd(), '.env');
      if (!fs.existsSync(envPath)) {
        const envContent =
          `# AgentOS Environment\n` +
          `AGENTOS_GATEWAY_TOKEN=${config.gateway.token}\n` +
          (aiProvider === 'gemini'    ? `GEMINI_API_KEY=${aiKey}\n`    : '') +
          (aiProvider === 'openai'    ? `OPENAI_API_KEY=${aiKey}\n`    : '') +
          (aiProvider === 'anthropic' ? `ANTHROPIC_API_KEY=${aiKey}\n` : '');
        fs.writeFileSync(envPath, envContent);
        console.log(chalk.gray(`\n  → .env created at ${envPath}`));
      }

      // ── Done ──────────────────────────────────────────────────────────────
      console.log(chalk.green(`\n✓ Configuration saved → ${CONFIG_PATH}\n`));
      console.log(chalk.cyan('Next steps:'));
      console.log(`  1. ${chalk.yellow('agentos gateway')}    – Start the agent gateway`);
      console.log(`  2. ${chalk.yellow('agentos doctor')}     – Verify everything works`);
      console.log(`  3. ${chalk.yellow('agentos status')}     – Live system health\n`);
    });
};

// ── Path helper (used inside closures above) ──────────────────────────────────
const path = require('path');
