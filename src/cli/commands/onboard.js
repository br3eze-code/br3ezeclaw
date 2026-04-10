// ==========================================
// AGENTOS ONBOARD COMMAND
// Interactive configuration wizard
// ==========================================

const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs');
const { testMikroTikConnection } = require('../../core/mikrotik');

module.exports = (program) => {
    program
        .command('onboard')
        .description('Interactive onboarding wizard')
        .option('--reset', 'Reset existing configuration')
        .action(async (options) => {
            const { BRAND, CONFIG_PATH } = global.AGENTOS;

            console.log(chalk.cyan(`\n🚀 Welcome to ${BRAND.name} Setup!\n`));
            console.log(chalk.gray('This wizard will configure your network gateway.\n'));

            // Check existing config
            if (fs.existsSync(CONFIG_PATH) && !options.reset) {
                const { overwrite } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'overwrite',
                    message: 'Configuration exists. Re-run setup?',
                    default: false
                }]);
                if (!overwrite) {
                    console.log(chalk.yellow('\nSetup cancelled. Use --reset to force.'));
                    return;
                }
            }

            // Step 1: MikroTik Configuration
            console.log(chalk.cyan('\n📡 Step 1: MikroTik Router Configuration\n'));

            const mikrotikConfig = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'ip',
                    message: 'Router IP address:',
                    default: '192.168.88.1',
                    validate: (input) => /^\d+\.\d+\.\d+\.\d+$/.test(input) || 'Invalid IP format'
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
                    validate: (input) => input.length > 0 || 'Password required'
                },
                {
                    type: 'number',
                    name: 'port',
                    message: 'API Port:',
                    default: 8728
                }
            ]);

            // Test connection
            const spinner = ora('Testing MikroTik connection...').start();
            try {
                await testMikroTikConnection(mikrotikConfig);
                spinner.succeed(chalk.green('✓ MikroTik connected successfully'));
            } catch (error) {
                spinner.fail(chalk.red(`✗ Connection failed: ${error.message}`));
                const { continueAnyway } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'continueAnyway',
                    message: 'Continue setup anyway?',
                    default: false
                }]);
                if (!continueAnyway) return;
            }

            // Step 2: Telegram Bot Setup
            console.log(chalk.cyan('\n🤖 Step 2: Telegram Bot Configuration\n'));

            const telegramConfig = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'token',
                    message: 'Bot Token (from @BotFather):',
                    validate: (input) => input.includes(':') || 'Invalid token format'
                },
                {
                    type: 'input',
                    name: 'allowedChats',
                    message: 'Allowed Chat IDs (comma-separated):',
                    filter: (input) => input.split(',').map(s => s.trim()).filter(Boolean)
                }
            ]);

            // Step 3: Gateway Settings
            console.log(chalk.cyan('\n🌐 Step 3: Gateway Configuration\n'));

            const gatewayConfig = await inquirer.prompt([
                {
                    type: 'number',
                    name: 'port',
                    message: 'Gateway WebSocket Port:',
                    default: 19876
                },
                {
                    type: 'confirm',
                    name: 'autostart',
                    message: 'Auto-start gateway on boot?',
                    default: true
                }
            ]);

            // Step 4: Hotspot Profiles
            console.log(chalk.cyan('\n📋 Step 4: Hotspot Plans\n'));

            const plans = [];
            let addMore = true;

            while (addMore) {
                const plan = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'name',
                        message: 'Plan name (e.g., 1hour, 1day):',
                        validate: (input) => /^[a-zA-Z0-9]+$/.test(input) || 'Alphanumeric only'
                    },
                    {
                        type: 'input',
                        name: 'duration',
                        message: 'Duration (e.g., 1h, 24h, 7d):',
                        default: '1h'
                    },
                    {
                        type: 'input',
                        name: 'rateLimit',
                        message: 'Rate limit (e.g., 2M/2M):',
                        default: '2M/2M'
                    }
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

            // Save configuration
            const config = {
                name: BRAND.name,
                version: BRAND.version,
                createdAt: new Date().toISOString(),
                mikrotik: mikrotikConfig,
                telegram: telegramConfig,
                gateway: {
                    ...gatewayConfig,
                    host: '127.0.0.1',
                    token: require('crypto').randomBytes(32).toString('hex')
                },
                plans,
                features: {
                    vouchers: true,
                    telegramBot: true,
                    webDashboard: true,
                    websocketApi: true
                }
            };

            fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

            console.log(chalk.green(`\n✓ Configuration saved to ${CONFIG_PATH}\n`));
            console.log(chalk.cyan('Next steps:'));
            console.log(`  1. ${chalk.yellow('agentos gateway')}     - Start the gateway`);
            console.log(`  2. ${chalk.yellow('agentos doctor')}      - Verify setup`);
            console.log(`  3. ${chalk.yellow('agentos status')}      - Check system health\n`);
        });
};