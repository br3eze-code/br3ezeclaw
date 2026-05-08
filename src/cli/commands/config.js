// ==========================================
// AGENTOS CONFIG COMMAND
// Configuration management
// ==========================================

const _chalk = require('chalk');
const chalk  = _chalk.default || _chalk;
const fs = require('fs');
const { intro, outro, note, log } = require('@clack/prompts');

module.exports = (program) => {
    const config = program
        .command('config')
        .description('Manage configuration');

    // Subcommand: config get
    config
        .command('get <path>')
        .description('Get a config value by dot-notation path  (e.g. mikrotik.ip)')
        .action((path) => {
            const { CONFIG_PATH } = global.AGENTOS;

            if (!fs.existsSync(CONFIG_PATH)) {
                log.error('No configuration found');
                process.exit(1);
            }

            const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            const value = path.split('.').reduce((obj, key) => obj?.[key], cfg);

            if (value !== undefined) {
                log.info(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value));
            } else {
                log.warn('undefined');
            }
        });

    // Subcommand: config set
    config
        .command('set <path> <value>')
        .description('Set a config value by dot-notation path  (e.g. mikrotik.port 8729)')
        .action((path, value) => {
            const { CONFIG_PATH } = global.AGENTOS;

            if (!fs.existsSync(CONFIG_PATH)) {
                log.error('No configuration found');
                process.exit(1);
            }

            const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            const keys = path.split('.');
            const last = keys.pop();

            let target = cfg;
            for (const key of keys) {
                if (!target[key]) target[key] = {};
                target = target[key];
            }

            // Try to parse as number/boolean
            let parsed = value;
            if (value === 'true') parsed = true;
            else if (value === 'false') parsed = false;
            else if (!isNaN(value)) parsed = Number(value);

            target[last] = parsed;
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
            log.success(`Set ${path} = ${parsed}`);
        });

    // Subcommand: config edit
    config
        .command('edit')
        .description('Edit configuration in default editor')
        .action(() => {
            const { CONFIG_PATH } = global.AGENTOS;
            const editor = process.env.EDITOR || 'nano';

            const { spawn } = require('child_process');
            spawn(editor, [CONFIG_PATH], { stdio: 'inherit' });
        });

    // Subcommand: config show
    config
        .command('show')
        .description('Display full configuration')
        .option('--sensitive', 'Show sensitive values (tokens, passwords)')
        .action((options) => {
            const { CONFIG_PATH } = global.AGENTOS;

            intro('📄 Configuration');

            if (!fs.existsSync(CONFIG_PATH)) {
                log.error('No configuration found');
                process.exit(1);
            }

            let cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

            if (!options.sensitive) {
                // Mask sensitive fields
                cfg = JSON.parse(JSON.stringify(cfg)); // Deep copy
                if (cfg.adapters?.mikrotik?.password) cfg.adapters.mikrotik.password = '********';
                if (cfg.mikrotik?.pass) cfg.mikrotik.pass = '********';
                if (cfg.telegram?.token) cfg.telegram.token = cfg.telegram.token.substring(0, 10) + '...';
                if (cfg.gateway?.token) cfg.gateway.token = cfg.gateway.token.substring(0, 16) + '...';
            }

            note(JSON.stringify(cfg, null, 2), 'Current State');
            outro(chalk.green('✓ Done.'));
        });
};

