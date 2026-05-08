'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const inquirer = require('inquirer');

let _clack;
const intro = (...args) => _clack.intro(...args);
const outro = (...args) => _clack.outro(...args);
const note = (...args) => _clack.note(...args);
const spinner = (...args) => _clack.spinner(...args);
const cancel = (...args) => _clack.cancel(...args);
const isCancel = (...args) => _clack.isCancel(...args);
const log = {
  success: (...args) => _clack.log.success(...args),
  error: (...args) => _clack.log.error(...args),
  warn: (...args) => _clack.log.warn(...args),
  info: (...args) => _clack.log.info(...args)
};
const chalk = require('chalk');
const { onboardFleet, onboardRouter } = require('../../core/onboard');

/** clack doesn't have a good way to handle inquirer-style loops easily, so we use inquirer for data entry */
async function prompt(questions) {
  // Add a small prefix to differentiate inquirer from clack
  if (Array.isArray(questions)) {
    questions.forEach(q => {
      q.message = chalk.cyan('? ') + q.message;
    });
  } else if (typeof questions === 'object') {
    questions.message = chalk.cyan('? ') + questions.message;
  }
  return inquirer.prompt(questions);
}

// Domain catalogue  ─────────────────────────────────────────────────────────────
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
  cctv: {
    label: 'CCTV & Camera Systems (Dahua, Amcrest, Hikvision)',
    requiresAdapter: true,
    adapterKey: 'cctv'
  },
  general: {
    label: 'General AI Assistant (no specific infrastructure)',
    requiresAdapter: false
  },
  codegen: {
    label: 'Code Generation & AI Coding Assistant',
    requiresAdapter: false
  },
  custom: {
    label: 'Custom / Skip (configure manually later)',
    requiresAdapter: false
  }
};

// ── MikroTik adapter ────────────────────────────────────────────────────────────
async function collectMikroTikConfig(existing = {}) {
  const { testMikroTikConnection } = require('../../core/mikrotik');
  note(chalk.gray('Configure one or more RouterOS API endpoints.'), chalk.cyan('📡 MikroTik Routers'));

  const routers = {};
  let addMore = true, idx = 0, defaultRouterId = null;

  while (addMore) {
    idx++;
    const answers = await prompt([
      {
        type: 'input',
        name: 'routerId',
        message: `Router ID (e.g. hq-router, branch-${idx}):`,
        default: `router-${idx}`,
        validate: v => /^[a-zA-Z0-9_-]+$/.test(v.trim()) ? true : 'Alphanumeric, dash, underscore only'
      },
      {
        type: 'input',
        name: 'ip',
        message: 'Router IP address:',
        default: existing.routers?.[`router-${idx}`]?.host || existing.host || '192.168.88.1',
        validate: v => /^\d+\.\d+\.\d+\.\d+$/.test(v.trim()) ? true : 'Invalid IP'
      },
      {
        type: 'input',
        name: 'user',
        message: 'API Username:',
        default: existing.routers?.[`router-${idx}`]?.user || existing.user || 'admin'
      },
      {
        type: 'password',
        name: 'pass',
        message: 'API Password:',
        validate: v => v.length > 0 ? true : 'Password required'
      },
      {
        type: 'number',
        name: 'port',
        message: 'API Port:',
        default: existing.routers?.[`router-${idx}`]?.port || existing.port || 8728
      }
    ]);

    const s = spinner();
    s.start(`Testing connection to ${answers.routerId}…`);
    try {
      const r = await testMikroTikConnection({ host: answers.ip.trim(), user: answers.user.trim(), password: answers.pass, port: answers.port });
      if (!r.success) throw new Error(r.message);
      s.stop(`✓ ${answers.routerId} connected`);
    } catch (err) {
      s.stop(`— ${err.message}`);
      const { cont } = await prompt({ type: 'confirm', name: 'cont', message: 'Continue anyway?', default: true });
      if (!cont) { throw new Error('Setup cancelled by user'); }
    }

    routers[answers.routerId] = { host: answers.ip.trim(), user: answers.user.trim(), password: answers.pass, port: answers.port };
    if (!defaultRouterId) defaultRouterId = answers.routerId;

    const { more } = await prompt({ type: 'confirm', name: 'more', message: 'Add another MikroTik router?', default: false });
    addMore = more;
  }

  const r = routers[defaultRouterId];
  return { host: r.host, user: r.user, password: r.password, port: r.port, routers };
}

// ── CCTV adapter ────────────────────────────────────────────────────────────────
async function collectCCTVConfig() {
  note(chalk.gray('Add each camera or NVR device.'), chalk.blue('📹 CCTV / Cameras'));
  const devices = [];
  let addMore = true;

  while (addMore) {
    const answers = await prompt([
      {
        type: 'list',
        name: 'driver',
        message: 'Camera system:',
        choices: [
          { value: 'dahua', name: 'Dahua / Amcrest / Lorex' },
          { value: 'hikvision', name: 'Hikvision / EZVIZ / Annke' }
        ]
      },
      {
        type: 'input',
        name: 'deviceId',
        message: 'Device ID:',
        default: `cam${devices.length + 1}`,
        validate: v => /^[a-zA-Z0-9_-]+$/.test(v) ? true : 'Invalid ID'
      },
      {
        type: 'input',
        name: 'host',
        message: 'Device IP:',
        default: '192.168.1.108'
      },
      {
        type: 'number',
        name: 'port',
        message: 'HTTP Port:',
        default: 80
      },
      {
        type: 'input',
        name: 'user',
        message: 'Username:',
        default: 'admin'
      },
      {
        type: 'password',
        name: 'pass',
        message: 'Password:',
        validate: v => v.length > 0 ? true : 'Required'
      }
    ]);

    devices.push({
      driver: answers.driver,
      deviceId: answers.deviceId,
      host: answers.host.trim(),
      port: answers.port,
      user: answers.user.trim(),
      password: answers.pass
    });

    const { more } = await prompt({ type: 'confirm', name: 'more', message: 'Add another device?', default: false });
    addMore = more;
  }
  return devices;
}

// ── Firebase ────────────────────────────────────────────────────────────────────
async function collectFirebaseConfig(existing = {}) {
  note(chalk.gray('Connect AgentOS to Firebase for cloud sync and user data.'), chalk.yellow('🔥 Firebase'));
  const { configType } = await prompt({
    type: 'list',
    name: 'configType',
    message: 'Firebase config type:',
    choices: [
      { value: 'serviceAccount', name: 'Service Account JSON (recommended)' },
      { value: 'apiKey', name: 'API Key (limited features)' },
      { value: 'none', name: 'Skip for now' }
    ]
  });

  if (configType === 'none') return { enabled: false };

  if (configType === 'serviceAccount') {
    const answers = await prompt([
      {
        type: 'input',
        name: 'saKeyPath',
        message: 'Path to serviceAccountKey.json:',
        default: existing.serviceAccount || './serviceAccountKey.json',
        validate: v => fs.existsSync(v) ? true : 'File not found'
      },
      {
        type: 'input',
        name: 'dbUrl',
        message: 'Firebase Database URL:',
        default: existing.databaseURL || '',
        validate: v => v.startsWith('http') ? true : 'Invalid URL'
      }
    ]);

    let projectId = '';
    try {
      projectId = JSON.parse(fs.readFileSync(path.resolve(answers.saKeyPath), 'utf8')).project_id || '';
      if (projectId) log.success(`Project ID detected: ${projectId}`);
    } catch (_) { }

    if (!projectId) {
      const { pId } = await prompt({ type: 'input', name: 'pId', message: 'Firebase Project ID:', validate: v => v.length > 0 ? true : 'Required' });
      projectId = pId;
    }
    return { enabled: true, type: 'serviceAccount', serviceAccount: answers.saKeyPath, databaseURL: answers.dbUrl, projectId };
  }

  const apiAnswers = await prompt([
    { type: 'input', name: 'apiKey', message: 'Firebase API Key:', validate: v => v.length > 0 ? true : 'Required' },
    { type: 'input', name: 'projectId', message: 'Firebase Project ID:', validate: v => v.length > 0 ? true : 'Required' },
    { type: 'input', name: 'databaseURL', message: 'Firebase Database URL:', validate: v => v.startsWith('http') ? true : 'Invalid URL' }
  ]);
  return { ...apiAnswers, enabled: true, type: 'apiKey' };
}

// ── Hotspot plans ─────────────────────────────────────────────────────────────
async function collectHotspotPlans(existingPlans = []) {
  if (existingPlans && existingPlans.length > 0) {
    log.info(`Current plans: ${existingPlans.map(p => p.name).join(', ')}`);
    const { keep } = await prompt({ type: 'confirm', name: 'keep', message: 'Keep existing plans?', default: true });
    if (keep) return existingPlans;
  }

  note(chalk.gray('Define WiFi voucher tiers customers can purchase.'), chalk.green('📋 Hotspot Plans'));
  const plans = [];
  let addMore = true;

  while (addMore) {
    const answers = await prompt([
      { type: 'input', name: 'name', message: 'Plan name (e.g. 1 Hour, 1 Day):', validate: v => v.trim().length > 0 ? true : 'Required' },
      { type: 'input', name: 'description', message: 'Short description:', default: 'Internet access plan' },
      { type: 'number', name: 'deviceLimit', message: 'Max devices per voucher:', default: 1 },
      {
        type: 'list',
        name: 'durationUnit',
        message: 'Duration unit:',
        choices: [
          { value: 'hours', name: 'Hours' },
          { value: 'days', name: 'Days' },
          { value: 'weeks', name: 'Weeks' },
          { value: 'months', name: 'Months' },
          { value: null, name: 'Unlimited' }
        ]
      },
      {
        type: 'number',
        name: 'durationValue',
        message: 'Duration value:',
        default: 1,
        when: (a) => a.durationUnit !== null
      },
      { type: 'input', name: 'imageUrl', message: 'Image URL (optional):', default: '' },
      { type: 'input', name: 'mikrotikProfile', message: 'MikroTik profile ID:', default: (a) => a.name.toLowerCase().replace(/\s+/g, ''), validate: v => /^[a-zA-Z0-9_-]+$/.test(v) ? true : 'Invalid ID' },
      { type: 'number', name: 'price', message: 'Price (local currency):', default: 10 },
      { type: 'input', name: 'currency', message: 'Currency code:', default: 'KES' },
      { type: 'confirm', name: 'active', message: 'Active (available for purchase)?', default: true }
    ]);

    plans.push({ ...answers, currency: answers.currency.toUpperCase() });
    const { more } = await prompt({ type: 'confirm', name: 'more', message: 'Add another plan?', default: plans.length < 3 });
    addMore = more;
  }
  return plans;
}

// ── Payment config ────────────────────────────────────────────────────────────
async function collectPaymentConfig(existing = {}) {
  note(chalk.gray('Configure a payment gateway so customers can self-serve vouchers.'), chalk.magenta('💳 Payment Provider'));
  const { provider } = await prompt({
    type: 'list',
    name: 'provider',
    message: 'Payment provider:',
    choices: [
      { value: 'none', name: 'None (manual / cash)' },
      { value: 'pesapay', name: 'PesaPay (Africa — card, M-Pesa, EFT)' },
      { value: 'stripe', name: 'Stripe (global — card, bank)' },
      { value: 'mpesa', name: 'M-Pesa (Safaricom Daraja API)' },
      { value: 'mastercard', name: 'Mastercard / Peach Payments (ZA)' },
      { value: 'webhook', name: 'Manual webhook URL (custom)' }
    ],
    default: existing.provider || 'none'
  });

  if (provider === 'none') return { provider, configured: false };

  log.info('Tip: you can also set credentials in .env later.');
  const c = existing.credentials || {};
  let credentials = {};

  if (provider === 'pesapay') {
    credentials = await prompt([
      { type: 'password', name: 'apiKey', message: 'PesaPay API Key:' },
      { type: 'password', name: 'merchantId', message: 'Merchant ID:' },
      { type: 'input', name: 'baseUrl', message: 'Base URL:', default: c.baseUrl || 'https://www.pesapay.co.za' }
    ]);
  } else if (provider === 'stripe') {
    credentials = await prompt([
      { type: 'password', name: 'secretKey', message: 'Stripe Secret Key (sk_…):' },
      { type: 'input', name: 'webhookSecret', message: 'Webhook Secret (optional):', default: c.webhookSecret || '' },
      { type: 'input', name: 'successUrl', message: 'Success redirect URL:', default: c.successUrl || 'http://localhost:3000/success' },
      { type: 'input', name: 'cancelUrl', message: 'Cancel redirect URL:', default: c.cancelUrl || 'http://localhost:3000/cancel' }
    ]);
  } else if (provider === 'mpesa') {
    credentials = await prompt([
      { type: 'input', name: 'consumerKey', message: 'Daraja Consumer Key:', default: c.consumerKey || '' },
      { type: 'password', name: 'consumerSecret', message: 'Consumer Secret:' },
      { type: 'input', name: 'shortcode', message: 'Shortcode (Paybill/Till):', default: c.shortcode || '' },
      { type: 'password', name: 'passkey', message: 'Passkey:' },
      { type: 'list', name: 'env', message: 'Environment:', choices: ['sandbox', 'production'], default: c.env || 'sandbox' }
    ]);
  } else if (provider === 'mastercard') {
    credentials = await prompt([
      { type: 'password', name: 'apiKey', message: 'Peach Payments API Key:' },
      { type: 'input', name: 'entityId', message: 'Entity ID:', default: c.entityId || '' },
      { type: 'input', name: 'baseUrl', message: 'Base URL:', default: c.baseUrl || 'https://testsecure.peachpayments.com' }
    ]);
  } else if (provider === 'webhook') {
    credentials = await prompt([
      { type: 'input', name: 'callbackUrl', message: 'Webhook URL:', default: c.callbackUrl || '' },
      { type: 'password', name: 'webhookSecret', message: 'Webhook secret (optional):' }
    ]);
  }

  const { currency } = await prompt({
    type: 'input',
    name: 'currency',
    message: 'Default currency:',
    default: existing.currency || (provider === 'mpesa' ? 'KES' : provider === 'pesapay' ? 'ZAR' : 'USD')
  });

  return { provider, currency: currency.trim().toUpperCase(), credentials, configured: true };
}

module.exports = (program) => {
  program
    .command('onboard')
    .description('Interactive domain-agnostic setup wizard')
    .option('--reset', 'Overwrite existing configuration')
    .action(async (options) => {
      _clack = await import('@clack/prompts');
      if (!global.AGENTOS) {
        console.error('onboard must be run via the agentos CLI, not directly.');
        process.exit(1);
      }
      const { BRAND, CONFIG_PATH } = global.AGENTOS;
      const { logger } = require('../../core/logger');

      // Silence console logs during onboarding
      logger.transports.forEach(t => { if (t instanceof require('winston').transports.Console) t.silent = true; });

      intro(chalk.bgCyan.black.bold(` 🚀 ${BRAND.name} Setup — v${BRAND.version} `));

      // ── Guard: existing config ─────────────────────────────────────────────
      let existingConfig = {};
      const configExists = fs.existsSync(CONFIG_PATH);

      if (configExists) {
        try {
          existingConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        } catch (e) {
          console.warn(chalk.yellow('! Could not parse existing config, starting fresh.'));
        }
      }

      if (configExists && !options.reset) {
        const { mode } = await prompt({
          type: 'list',
          name: 'mode',
          message: 'Configuration already exists. What would you like to do?',
          choices: [
            { value: 'update', name: 'Update existing values' },
            { value: 'reset', name: 'Overwrite completely (start fresh)' },
            { value: 'cancel', name: 'Cancel' }
          ]
        });
        if (mode === 'cancel') { outro('Nothing changed.'); return; }
        if (mode === 'reset') existingConfig = {};
      }

      // ── Step 1: Domains ──────────────────────────────────────────────────
      note(chalk.gray('Select every domain this AgentOS node will manage.'), chalk.blue.bold('🌐 Step 1 — Domains'));
      const { selectedDomains } = await prompt({
        type: 'checkbox',
        name: 'selectedDomains',
        message: 'Domains:',
        choices: Object.entries(DOMAIN_CATALOGUE).map(([key, val]) => ({
          value: key, name: val.label, checked: (existingConfig.domains || []).includes(key)
        })),
        validate: v => v.length > 0 ? true : 'Select at least one domain'
      });

      // ── Step 2: Adapters ──────────────────────────────────────────────────
      const adapters = {};
      if (selectedDomains.includes('mikrotik')) adapters.mikrotik = await collectMikroTikConfig(existingConfig.adapters?.mikrotik);
      if (selectedDomains.includes('cctv')) {
        const devs = await collectCCTVConfig();
        adapters.cctv = { dahua_devices: {}, hikvision_devices: {} };
        for (const d of devs) {
          const target = d.driver === 'dahua' ? 'dahua_devices' : 'hikvision_devices';
          adapters.cctv[target][d.deviceId] = { ...d };
        }
      }

      // ── Step 3: Telegram ──────────────────────────────────────────────────
      note(chalk.gray('Optional: receive alerts and issue commands via Telegram.'), chalk.cyan.bold('🤖 Step 3 — Telegram'));
      const { wantsTelegram } = await prompt({ type: 'confirm', name: 'wantsTelegram', message: 'Configure Telegram bot?', default: existingConfig.telegram?.enabled ?? selectedDomains.includes('mikrotik') });
      let telegramConfig = { enabled: false, token: '', allowedChats: [] };
      if (wantsTelegram) {
        const telAnswers = await prompt([
          { type: 'input', name: 'token', message: 'Bot Token (from @BotFather):', default: existingConfig.telegram?.token || '', validate: v => /^\d+:[A-Za-z0-9_-]{35,}$/.test(v.trim()) ? true : 'Invalid token format' },
          { type: 'input', name: 'chatsRaw', message: 'Allowed Chat IDs (comma-separated, blank = all):', default: (existingConfig.telegram?.allowedChats || []).join(', ') }
        ]);
        telegramConfig = { enabled: true, token: telAnswers.token.trim(), allowedChats: telAnswers.chatsRaw.split(',').map(s => s.trim()).filter(Boolean) };
      }

      // ── Step 3.5: WhatsApp ───────────────────────────────────────────────
      note(chalk.gray('Optional: receive alerts and issue commands via WhatsApp.'), chalk.greenBright.bold('📱 Step 3.5 — WhatsApp'));
      const { wantsWhatsApp } = await prompt({
        type: 'confirm',
        name: 'wantsWhatsApp',
        message: 'Configure WhatsApp channel?',
        default: existingConfig.whatsapp?.enabled ?? selectedDomains.includes('mikrotik')
      });
      let whatsappConfig = { enabled: false, authStateFolder: './data/whatsapp_auth', allowedJids: [] };
      if (wantsWhatsApp) {
        const waAnswers = await prompt([
          {
            type: 'input',
            name: 'authDir',
            message: 'Auth state folder:',
            default: existingConfig.whatsapp?.authStateFolder || './data/whatsapp_auth'
          },
          {
            type: 'input',
            name: 'jidsRaw',
            message: 'Allowed JIDs (comma-separated, blank = all):',
            default: (existingConfig.whatsapp?.allowedJids || []).join(', ')
          }
        ]);
        whatsappConfig = {
          enabled: true,
          authStateFolder: waAnswers.authDir.trim(),
          allowedJids: waAnswers.jidsRaw.split(',').map(s => s.trim()).filter(Boolean)
        };
      }

      // ── Step 3.6: Slack ──────────────────────────────────────────────────
      note(chalk.gray('Optional: receive alerts and issue commands via Slack.'), chalk.cyanBright.bold('💬 Step 3.6 — Slack'));
      const { wantsSlack } = await prompt({
        type: 'confirm',
        name: 'wantsSlack',
        message: 'Configure Slack channel?',
        default: existingConfig.slack?.enabled || false
      });
      let slackConfig = { enabled: false };
      if (wantsSlack) {
        const slackAnswers = await prompt([
          { type: 'password', name: 'token', message: 'Slack Bot Token (xoxb-...):', default: existingConfig.slack?.token },
          { type: 'password', name: 'appToken', message: 'Slack App Token (xapp-...):', default: existingConfig.slack?.appToken },
          { type: 'confirm', name: 'socketMode', message: 'Enable Socket Mode?', default: existingConfig.slack?.socketMode !== false }
        ]);
        slackConfig = { enabled: true, ...slackAnswers };
      }

      // ── Step 3.7: Discord ────────────────────────────────────────────────
      note(chalk.gray('Optional: receive alerts and issue commands via Discord.'), chalk.blueBright.bold('🎮 Step 3.7 — Discord'));
      const { wantsDiscord } = await prompt({
        type: 'confirm',
        name: 'wantsDiscord',
        message: 'Configure Discord channel?',
        default: existingConfig.discord?.enabled || false
      });
      let discordConfig = { enabled: false };
      if (wantsDiscord) {
        const { token } = await prompt({ type: 'password', name: 'token', message: 'Discord Bot Token:', default: existingConfig.discord?.token });
        discordConfig = { enabled: true, token };
      }

      // ── Step 4: AI Provider ───────────────────────────────────────────────
      note(chalk.gray('Pick the AI brain powering your agents.'), chalk.magentaBright.bold('🧠 Step 4 — AI Provider'));
      // Load all providers via LLMCoordinator to ensure they are registered
      const LLMCoordinator = require('../../core/llm/LLMCoordinator');
      new LLMCoordinator('none'); // Force-load all providers

      const registry = BaseProvider.getRegistry();
      const aiChoices = Object.entries(registry)
        .map(([id, cls]) => {
          try {
            const meta = cls.getMetadata();
            return { value: id, name: meta.name };
          } catch (e) {
            return { value: id, name: id.charAt(0).toUpperCase() + id.slice(1) };
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      aiChoices.push({ value: 'none', name: 'None / Bring Your Own' });

      const { aiProvider } = await prompt({
        type: 'list',
        name: 'aiProvider',
        message: 'Primary AI provider:',
        choices: [
          { value: 'gemini', name: 'Google Gemini (Pro/Flash)' },
          { value: 'gemma', name: 'Google Gemma (Open Models)' },
          { value: 'openai', name: 'OpenAI (GPT-4o)' },
          { value: 'anthropic', name: 'Anthropic (Claude)' },
          { value: 'llama', name: 'Meta Llama (via Groq/Together)' },
          { value: 'deepseek', name: 'DeepSeek (Cheap & Strong)' },
          { value: 'groq', name: 'Groq (Ultra Fast)' },
          { value: 'together', name: 'Together AI (Open Models)' },
          { value: 'openrouter', name: 'OpenRouter (Unified API)' },
          { value: 'moonshot', name: 'Moonshot AI (Kimi)' },
          { value: 'minimax', name: 'MiniMax (abab6.5)' },
          { value: 'xai', name: 'xAI (Grok)' },
          { value: 'ollama', name: 'Ollama (Local AI)' },
          { value: 'none', name: 'None / Bring Your Own' }
        ],
        default: existingConfig.ai?.provider || 'gemini'
      });

      let aiKey = '';
      if (aiProvider !== 'none') {
        const keyName = {
          gemini: 'GEMINI_API_KEY',
          gemma: 'GEMINI_API_KEY',
          openai: 'OPENAI_API_KEY',
          anthropic: 'ANTHROPIC_API_KEY',
          llama: 'GROQ_API_KEY',
          together: 'TOGETHER_AI_API_KEY',
          deepseek: 'DEEPSEEK_API_KEY',
          groq: 'GROQ_API_KEY',
          openrouter: 'OPENROUTER_API_KEY',
          moonshot: 'MOONSHOT_API_KEY',
          minimax: 'MINIMAX_API_KEY',
          xai: 'XAI_API_KEY'
        }[aiProvider];
        const envKey = process.env[keyName];
        if (envKey) {
          log.success(`Using ${keyName} from environment`);
          aiKey = envKey;
        } else {
          const { key } = await prompt({ type: 'password', name: 'key', message: `${meta.name} API Key:` });
          aiKey = key;
        }

        const s = spinner();
        s.start(`Validating ${aiProvider} key…`);
        try {
          let prov;
          if (aiProvider === 'anthropic') { const { AnthropicProvider } = require('../../core/llm/providers/AnthropicProvider'); prov = new AnthropicProvider({ apiKey: aiKey }); }
          else if (aiProvider === 'openai') { const { OpenAIProvider } = require('../../core/llm/providers/OpenAIProvider'); prov = new OpenAIProvider({ apiKey: aiKey }); }
          else if (aiProvider === 'gemini') { const { GeminiProvider } = require('../../core/llm/providers/GeminiProvider'); prov = new GeminiProvider({ apiKey: aiKey }); }
          else if (aiProvider === 'gemma') { const { GemmaProvider } = require('../../core/llm/providers/GemmaProvider'); prov = new GemmaProvider({ apiKey: aiKey }); }
          else if (aiProvider === 'llama') { const { LlamaProvider } = require('../../core/llm/providers/LlamaProvider'); prov = new LlamaProvider({ apiKey: aiKey }); }
          else if (aiProvider === 'together') { const { TogetherAIProvider } = require('../../core/llm/providers/TogetherAIProvider'); prov = new TogetherAIProvider({ apiKey: aiKey }); }
          else if (aiProvider === 'deepseek') { const { DeepSeekProvider } = require('../../core/llm/providers/DeepSeekProvider'); prov = new DeepSeekProvider({ apiKey: aiKey }); }
          else if (aiProvider === 'groq') { const { GroqProvider } = require('../../core/llm/providers/GroqProvider'); prov = new GroqProvider({ apiKey: aiKey }); }
          else if (aiProvider === 'openrouter') { const { OpenRouterProvider } = require('../../core/llm/providers/OpenRouterProvider'); prov = new OpenRouterProvider({ apiKey: aiKey }); }
          else if (aiProvider === 'moonshot') { const { MoonshotProvider } = require('../../core/llm/providers/MoonshotProvider'); prov = new MoonshotProvider({ apiKey: aiKey }); }
          else if (aiProvider === 'minimax') { const { MiniMaxProvider } = require('../../core/llm/providers/MiniMaxProvider'); prov = new MiniMaxProvider({ apiKey: aiKey }); }
          else if (aiProvider === 'xai') { const { XAIProvider } = require('../../core/llm/providers/XAIProvider'); prov = new XAIProvider({ apiKey: aiKey }); }
          else if (aiProvider === 'ollama') { const { OllamaProvider } = require('../../core/llm/providers/OllamaProvider'); prov = new OllamaProvider({ apiKey: aiKey }); }

          if (prov) {
            const r = await prov.validateKey();
            if (r.valid) s.stop(`✓ ${aiProvider} key valid`);
            else {
              s.stop(`— Validation failed: ${r.error}`);
              const { cont } = await prompt({ type: 'confirm', name: 'cont', message: 'Continue anyway?', default: false });
              if (!cont) { outro('Setup cancelled.'); return; }
            }
          } else s.stop('Key stored (no validator)');
        } catch (e) { s.stop(`— ${e.message}`); }

        const { aiModel } = await prompt({
          type: 'input',
          name: 'aiModel',
          message: `${aiProvider} model to use:`,
          default: {
            gemini: 'gemini-1.5-pro',
            gemma: 'gemma2-9b-it',
            openai: 'gpt-4o',
            anthropic: 'claude-3-5-sonnet-20241022',
            llama: 'llama-3.1-70b-versatile',
            deepseek: 'deepseek-chat',
            groq: 'llama3-70b-8192',
            together: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
            openrouter: 'openai/gpt-4o',
            moonshot: 'moonshot-v1-8k',
            minimax: 'abab6.5-chat',
            xai: 'grok-beta',
            ollama: 'llama3'
          }[aiProvider]
        });
        existingConfig.ai = { provider: aiProvider, apiKey: aiKey, model: aiModel };
      }

      // ── Step 5: Gateway ──────────────────────────────────────────────────
      note('Configure the AgentOS WebSocket gateway.', '🌐 Step 5 — Gateway');
      const gwAnswers = await prompt([
        { type: 'number', name: 'port', message: 'WebSocket port:', default: existingConfig.gateway?.port || 19876 },
        { type: 'confirm', name: 'autostart', message: 'Auto-start on boot (PM2)?', default: existingConfig.gateway?.autostart !== false }
      ]);
      const gatewayConfig = { port: gwAnswers.port, autostart: gwAnswers.autostart };

      // ── Step 6: Payment & Plans ──────────────────────────────────────────
      const paymentConfig = await collectPaymentConfig(existingConfig.payments);
      const firebaseConfig = await collectFirebaseConfig(existingConfig.firebase);

      let plans = [];
      if (selectedDomains.includes('mikrotik')) {
        plans = await collectHotspotPlans(existingConfig.plans);
      }

      // ── Build final config ────────────────────────────────────────────────
      const config = {
        name: BRAND.name, version: BRAND.version, createdAt: new Date().toISOString(),
        domains: selectedDomains, adapters,
        telegram: telegramConfig,
        whatsapp: whatsappConfig,
        slack: slackConfig,
        discord: discordConfig,
        ai: { provider: aiProvider, apiKey: aiKey, model: aiModel },
        gateway: { ...gatewayConfig, host: '127.0.0.1', token: existingConfig.gateway?.token || process.env.AGENTOS_GATEWAY_TOKEN || crypto.randomBytes(32).toString('hex') },
        firebase: firebaseConfig, payments: paymentConfig, plans,
        features: {
          vouchers: selectedDomains.includes('mikrotik'),
          telegramBot: wantsTelegram,
          whatsappBot: wantsWhatsApp,
          slackBot: wantsSlack,
          discordBot: wantsDiscord,
          webDashboard: true,
          payments: paymentConfig.provider !== 'none'
        }
      };

      // ── Summary Presentation (Clack) ──────────────────────────────────────
      note(
        chalk.gray(`Domains  : `) + chalk.cyan(selectedDomains.join(', ')) + `\n` +
        chalk.gray(`AI       : `) + chalk.magenta(aiProvider) + `\n` +
        chalk.gray(`Telegram : `) + (wantsTelegram ? chalk.green('enabled') : chalk.red('disabled')) + `\n` +
        chalk.gray(`WhatsApp : `) + (wantsWhatsApp ? chalk.green('enabled') : chalk.red('disabled')) + `\n` +
        chalk.gray(`Slack    : `) + (wantsSlack ? chalk.green('enabled') : chalk.red('disabled')) + `\n` +
        chalk.gray(`Discord  : `) + (wantsDiscord ? chalk.green('enabled') : chalk.red('disabled')) + `\n` +
        chalk.gray(`Gateway  : `) + chalk.cyan(`ws://127.0.0.1:${gatewayConfig.port}`) + `\n` +
        chalk.gray(`Firebase : `) + (firebaseConfig.enabled ? chalk.green('connected') : chalk.red('disabled')) + `\n` +
        chalk.gray(`Payments : `) + chalk.yellow(paymentConfig.provider),
        chalk.bold.green('📋 Configuration Summary')
      );

      const { confirmSave } = await prompt({ type: 'confirm', name: 'confirmSave', message: 'Save this configuration?', default: true });
      if (!confirmSave) { outro('Nothing saved.'); return; }

      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
      log.success(`Configuration saved → ${CONFIG_PATH}`);

      // Update global config in memory so adapters can use it immediately
      global.AGENTOS.config = config;

      if (selectedDomains.includes('mikrotik') && config.adapters.mikrotik) {
        const { applyNow } = await prompt({
          type: 'confirm',
          name: 'applyNow',
          message: 'Would you like to apply setup.rsc to your default MikroTik router now?',
          default: true
        });

        if (applyNow) {
          const s = spinner();
          s.start('Applying setup.rsc to MikroTik router…');
          try {
            const mk = config.adapters.mikrotik;
            const res = await onboardRouter({ host: mk.host, user: mk.user, password: mk.password, port: mk.port });
            if (res.success) {
              s.stop('✓ setup.rsc applied successfully');
            } else {
              s.stop(`— Failed to apply setup.rsc: ${res.error}`);
            }
          } catch (err) {
            s.stop(`— Error applying setup: ${err.message}`);
          }
        }
      }

      outro(chalk.bgGreen.black.bold(' ✨ AgentOS is configured and ready! Run: agentos gateway '));
    });
};
