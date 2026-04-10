// ==========================================
// AGENTOS CONFIG COMMAND
// Configuration management
// ==========================================

const chalk = require('chalk');
const fs = require('fs');
const inquirer = require('inquirer');

module.exports = (program) => {
    const config = program
        .command('config')
        .description('Manage configuration');

    // Subcommand: config get
    config
        .command('get <path>')
        .description('Get configuration value (dot notation)')
        .example('config get mikrotik.ip')
        .action((path) => {
            const { CONFIG_PATH } = global.AGENTOS;

            if (!fs.existsSync(CONFIG_PATH)) {
                console.log(chalk.red('✗ No configuration found'));
                return;
            }

            const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            const value = path.split('.').reduce((obj, key) => obj?.[key], cfg);

            if (value !== undefined) {
                console.log(typeof value === 'object' ? JSON.stringify(value, null, 2) : value);
            } else {
                console.log(chalk.gray('undefined'));
            }
        });

    // Subcommand: config set
    config
        .command('set <path> <value>')
        .description('Set configuration value')
        .example('config set mikrotik.port 8729')
        .action((path, value) => {
            const { CONFIG_PATH } = global.AGENTOS;

            if (!fs.existsSync(CONFIG_PATH)) {
                console.log(chalk.red('✗ No configuration found'));
                return;
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
            console.log(chalk.green(`✓ Set ${path} = ${parsed}`));
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

            if (!fs.existsSync(CONFIG_PATH)) {
                console.log(chalk.red('✗ No configuration found'));
                return;
            }

            let cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

            if (!options.sensitive) {
                // Mask sensitive fields
                cfg = JSON.parse(JSON.stringify(cfg)); // Deep copy
                if (cfg.mikrotik?.pass) cfg.mikrotik.pass = '********';
                if (cfg.telegram?.token) cfg.telegram.token = cfg.telegram.token.substring(0, 10) + '...';
                if (cfg.gateway?.token) cfg.gateway.token = cfg.gateway.token.substring(0, 16) + '...';
            }

            console.log(chalk.cyan('\n📄 Configuration:\n'));
            console.log(JSON.stringify(cfg, null, 2));
            console.log('');
        });
};