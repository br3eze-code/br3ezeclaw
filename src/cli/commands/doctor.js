'use strict';

const chalk = require('chalk');
const { intro, outro, spinner, note, log } = require('@clack/prompts');
const { execSync } = require('child_process');
const fs = require('fs');
const dgram = require('dgram');

module.exports = (program) => {
  program
    .command('doctor')
    .description('Health checks and quick fixes')
    .option('--fix', 'Auto-repair issues')
    .option('--deep', 'Deep system scan')
    .action(async (options) => {
      const { BRAND, CONFIG_PATH, STATE_PATH } = global.AGENTOS;

      intro(chalk.bgBlue.black.bold(` 🔧 ${BRAND.name} Health Check `));

      const checks = [];
      const s = spinner();

      // Check 1: Configuration
      s.start('Checking configuration...');
      let config = {};
      if (fs.existsSync(CONFIG_PATH)) {
        try {
          config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
          s.stop(chalk.green('✓ Configuration valid'));
          checks.push({ name: 'Config', status: 'ok', details: `v${config.version || 'unknown'}` });
        } catch (e) {
          s.stop(chalk.red('✗ Configuration corrupted'));
          checks.push({ name: 'Config', status: 'error', details: e.message });
        }
      } else {
        s.stop(chalk.red('✗ No configuration found'));
        checks.push({ name: 'Config', status: 'error', details: 'Run agentos onboard' });
      }

      // Load config using the core module if available, to merge env variables, etc.
      try {
        const { getConfig } = require('../../core/config');
        config = getConfig();
      } catch (e) {
        // Fallback to the raw JSON config
      }

      // Check 2: MikroTik Connection
      s.start('Testing MikroTik connection...');
      try {
        const { testMikroTikConnection } = require('../../core/mikrotik');
        const { getConfig } = require('../../core/config');
        const config = getConfig();

        const mkConfig = config.mikrotik || (config.adapters && config.adapters.mikrotik) || {};

        if (!mkConfig.host && !mkConfig.ip) {
          throw new Error('MikroTik config missing');
        }

        const result = await testMikroTikConnection(mkConfig);
        if (!result.success) throw new Error(result.message || 'Connection failed');

        s.stop(chalk.green('✓ MikroTik connected'));
        checks.push({ name: 'MikroTik', status: 'ok', details: mkConfig.host || mkConfig.ip });
      } catch (e) {
        s.stop(chalk.red(`✗ MikroTik error: ${e.message}`));
        checks.push({ name: 'MikroTik', status: 'error', details: e.message });
      }

      // Check 3: Firebase Connectivity
      s.start('Checking Firebase connectivity...');
      try {
        const { getDatabase } = require('../../core/database');
        const db = await getDatabase();
        if (db.db) {
          await db.getStats();
          s.stop(chalk.green('✓ Firebase Firestore connected'));
          checks.push({ name: 'Firebase', status: 'ok', details: 'Cloud mode active' });
        } else {
          s.stop(chalk.yellow('⚠ Firebase using local fallback'));
          checks.push({ name: 'Firebase', status: 'warn', details: 'Local mode active' });
        }
      } catch (e) {
        s.stop(chalk.red(`✗ Firebase error: ${e.message}`));
        checks.push({ name: 'Firebase', status: 'error', details: e.message });
      }

      // Check 4: Logs Daemon (UDP 5001)
      s.start('Checking Logs Daemon...');
      const checkLogsDaemon = () => new Promise((resolve) => {
        try {
          const isWin = process.platform === 'win32';
          // Use netstat to check if port 5001 is being listened on
          const cmd = isWin ? 'netstat -ano | findstr :5001' : 'lsof -i :5001';

          // Use a try-catch for execSync in case the command itself fails or returns non-zero (grep failure)
          let out = '';
          try {
            out = execSync(cmd, { stdio: 'pipe' }).toString();
          } catch (e) {
            // If findstr/grep finds nothing, it might exit with code 1
          }

          if (out.includes('5001') && (out.includes('LISTENING') || out.includes('UDP'))) {
            resolve({ status: 'ok', details: 'Active on port 5001' });
          } else {
            resolve({ status: 'warn', details: 'Daemon not detected' });
          }
        } catch (e) {
          resolve({ status: 'warn', details: 'Detection failed' });
        }
      });

      const logsStatus = await checkLogsDaemon();
      if (logsStatus.status === 'ok') {
        s.stop(chalk.green('✓ Logs Daemon active'));
      } else {
        s.stop(chalk.yellow('⚠ Logs Daemon inactive'));
      }
      checks.push({ name: 'Logs Daemon', ...logsStatus });

      // Check 5: Gateway Status
      s.start('Checking gateway process...');
      const path = require('path');
      const pidFile = path.join(STATE_PATH, 'gateway.pid');
      if (fs.existsSync(pidFile)) {
        try {
          const pid = fs.readFileSync(pidFile, 'utf8');
          process.kill(parseInt(pid), 0);
          s.stop(chalk.green(`✓ Gateway running (PID: ${pid})`));
          checks.push({ name: 'Gateway', status: 'ok', details: `PID ${pid}` });
        } catch (e) {
          s.stop(chalk.yellow('⚠ Gateway not running (stale PID)'));
          checks.push({ name: 'Gateway', status: 'warn', details: 'Stale process' });
          if (options.fix) {
            try { fs.unlinkSync(pidFile); } catch (_) { }
            log.info(chalk.gray('Cleaned up stale PID file'));
          }
        }
      } else {
        s.stop(chalk.yellow('⚠ Gateway not running'));
        checks.push({ name: 'Gateway', status: 'warn', details: 'Inactive' });
      }

      // Check 6: AI Engine
      s.start('Checking AI Engine...');
      try {
        const LLMCoordinator = require('../../core/llm/LLMCoordinator');
        const aiProvider = config.ai?.provider || 'none';
        const coordinator = new LLMCoordinator(aiProvider, config);

        if (aiProvider !== 'none' && config.ai?.key) {
          const provider = coordinator.createProvider(aiProvider, {
            apiKey: config.ai.key,
            model: config.ai.model
          });

          if (provider) {
            // Using a simple ping/validation if available, or just checking init
            await provider.initialize();

            // Try a lightweight validation if the provider supports it
            if (typeof provider.validateKey === 'function') {
              const r = await provider.validateKey();
              if (r.valid) {
                s.stop(chalk.green(`✓ AI Engine online (${aiProvider})`));
                checks.push({ name: 'AI Engine', status: 'ok', details: aiProvider });
              } else {
                const isRateLimit = r.error && (r.error.includes('429') || r.error.toLowerCase().includes('too many requests') || r.error.toLowerCase().includes('quota'));
                if (isRateLimit) {
                  s.stop(chalk.yellow(`⚠ AI Rate Limited: ${r.error}`));
                  checks.push({ name: 'AI Engine', status: 'warn', details: 'Rate Limited' });
                } else {
                  throw new Error(r.error);
                }
              }
            } else {
              s.stop(chalk.green(`✓ AI Engine initialized (${aiProvider})`));
              checks.push({ name: 'AI Engine', status: 'ok', details: aiProvider });
            }
          } else {
            throw new Error(`Provider ${aiProvider} could not be created`);
          }
        } else {
          s.stop(chalk.yellow('⚠ AI Engine disabled'));
          checks.push({ name: 'AI Engine', status: 'warn', details: 'No API key' });
        }
      } catch (e) {
        s.stop(chalk.red(`✗ AI error: ${e.message}`));
        checks.push({ name: 'AI Engine', status: 'error', details: e.message });
      }

      // Check 7-N: Messaging Channels
      const { BaseChannel } = require('../../core/channels/BaseChannel');
      const channelFiles = fs.readdirSync(path.join(__dirname, '../../core/channels'));
      for (const file of channelFiles) {
        if (file.endsWith('Channel.js') && file !== 'BaseChannel.js') {
          try { require(path.join(__dirname, '../../core/channels/', file)); } catch (_) { }
        }
      }

      const registeredAdapters = BaseChannel.getRegisteredTypes();

      for (const type of registeredAdapters) {
        const ChannelClass = BaseChannel.getAdapter(type);
        const meta = ChannelClass.getMetadata();
        const chanName = meta.name || type.charAt(0).toUpperCase() + type.slice(1);
        s.start(`Checking ${chanName} channel...`);

        const chanConfig = config[type] || (config.channels && config.channels.find(c => c.type === type)?.config);

        if (chanConfig?.enabled || (config.channels && config.channels.find(c => c.type === type))) {
          let status = 'ok';
          let details = 'Configured';

          // Use Channel's own validation if available
          try {
            const instance = new ChannelClass(chanConfig, { config: config });
            const v = await instance.validateConfig();
            if (!v.valid) {
              status = 'error';
              details = v.error;
            }
          } catch (e) {
            // Fallback to hardcoded legacy checks for un-refactored channels
            if (type === 'whatsapp') {
              const waAuthDir = chanConfig.authStateFolder || './data/whatsapp_auth';
              if (!fs.existsSync(waAuthDir)) {
                status = 'warn';
                details = 'Missing auth data';
              }
            } else if (type === 'slack') {
              if (!chanConfig.token || !chanConfig.appToken) {
                status = 'error';
                details = 'Missing Token/AppToken';
              }
            } else if (type === 'discord' || type === 'telegram') {
              if (!chanConfig.token) {
                status = 'error';
                details = 'Missing Token';
              }
            }
          }

          if (status === 'ok') s.stop(chalk.green(`✓ ${chanName} configured`));
          else if (status === 'warn') s.stop(chalk.yellow(`⚠ ${chanName}: ${details}`));
          else s.stop(chalk.red(`✗ ${chanName}: ${details}`));

          checks.push({ name: chanName, status, details });
        } else {
          s.stop(chalk.gray(`○ ${chanName} channel disabled`));
          if (['whatsapp', 'slack', 'discord', 'telegram'].includes(type)) {
            checks.push({ name: chanName, status: 'ok', details: 'Disabled' });
          }
        }
      }

      // Summary
      const errors = checks.filter(c => c.status === 'error').length;
      const warnings = checks.filter(c => c.status === 'warn').length;

      const summaryLines = checks.map(check => {
        const icon = check.status === 'ok' ? chalk.green('●') :
          check.status === 'warn' ? chalk.yellow('▲') : chalk.red('■');
        return `${icon} ${chalk.bold(check.name.padEnd(15))} ${chalk.gray(check.details || '')}`;
      });

      note(summaryLines.join('\n'), chalk.bold.white('📋 Health Report'));

      if (errors === 0 && warnings === 0) {
        outro(chalk.bgGreen.black.bold(' ✓ SYSTEM OPTIMAL '));
      } else if (errors === 0) {
        outro(chalk.bgYellow.black.bold(` ⚠ DEGRADED (${warnings} warnings) `));
      } else {
        outro(chalk.bgRed.white.bold(` ✗ CRITICAL (${errors} errors) `));
        if (!options.fix) {
          log.info(chalk.gray('Tip: Use "agentos doctor --fix" to attempt auto-repair.'));
        }
      }

      // Cleanup to prevent handle leaks causing Assertion failed in libuv (Windows)
      try {
        const { getDatabase } = require('../../core/database');
        const db = await getDatabase();
        if (db) await db.close();
      } catch (_) { }

      return;
    });
};
