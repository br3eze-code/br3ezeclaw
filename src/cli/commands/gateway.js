// ==========================================
// AGENTOS GATEWAY COMMAND
// Run, manage, and query the WebSocket gateway
// ==========================================

const chalk = require('chalk');
const ora = require('ora');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

const { STATE_PATH, getConfig } = require('../../core/config');
const { logger } = require('../../core/logger');

module.exports = (program) => {
    program
        .command('gateway')
        .description('Run, inspect, and query the WebSocket Gateway')
        .option('--daemon, -d', 'Run as background service')
        .option('--port <port>', 'Override gateway port')
        .option('--force', 'Kill existing process on port')
        .option('--verbose, -v', 'Verbose logging')
        .action(async (options) => {
            const { BRAND, CONFIG_PATH, STATE_PATH } = global.AGENTOS;

            // Check config exists
            if (!fs.existsSync(CONFIG_PATH)) {
                console.log(chalk.red('✗ No configuration found. Run: agentos onboard'));
                process.exit(1);
            }

            const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            const port = options.port || config.gateway.port || 19876;

            // Check if already running
            const pidFile = `${STATE_PATH}/gateway.pid`;
            if (fs.existsSync(pidFile) && !options.force) {
                const pid = fs.readFileSync(pidFile, 'utf8');
                console.log(chalk.yellow(`⚠ Gateway may already be running (PID: ${pid})`));
                console.log(chalk.gray('Use --force to override'));
            }

            // Kill existing if --force
            if (options.force) {
                try {
                    const pid = fs.readFileSync(pidFile, 'utf8');
                    process.kill(parseInt(pid), 'SIGTERM');
                    console.log(chalk.yellow(`✓ Killed existing gateway (PID: ${pid})`));
                } catch (e) {
                    // Process not running
                }
            }

            console.log(chalk.cyan(`\n🚀 Starting ${BRAND.name} Gateway...\n`));
            console.log(chalk.gray(`  Port: ${port}`));
            console.log(chalk.gray(`  Config: ${CONFIG_PATH}`));
            console.log(chalk.gray(`  Profile: ${global.AGENTOS.PROFILE_DIR}\n`));

            const spinner = ora('Initializing services...').start();

            try {
                // Import and start gateway
                const { startGateway } = require('../../core/gateway');

                const gateway = await startGateway({
                    ...config,
                    port,
                    verbose: options.verbose
                });

                // Save PID
                fs.writeFileSync(pidFile, process.pid.toString());

                spinner.succeed(chalk.green('Gateway running'));

                console.log(chalk.cyan('\n📡 Connection Info:'));
                console.log(chalk.gray(`  WebSocket: ws://127.0.0.1:${port}/ws`));
                console.log(chalk.gray(`  HTTP API:  http://127.0.0.1:${port}/health`));
                console.log(chalk.gray(`  Token:     ${config.gateway.token.substring(0, 16)}...\n`));

                console.log(chalk.cyan('Commands:'));
                console.log(`  ${chalk.yellow('Ctrl+C')}          - Stop gateway`);
                console.log(`  ${chalk.yellow('agentos status')}    - Check health`);
                console.log(`  ${chalk.yellow('agentos logs')}      - View logs\n`);

                // Handle graceful shutdown
                process.on('SIGINT', async () => {
                    console.log(chalk.yellow('\n\n⚠ Shutting down gateway...'));
                    await gateway.stop();
                    fs.unlinkSync(pidFile);
                    console.log(chalk.green('✓ Gateway stopped\n'));
                    process.exit(0);
                });

            } catch (error) {
                spinner.fail(chalk.red(`Failed to start: ${error.message}`));
                console.log(chalk.gray('\nTroubleshooting:'));
                console.log('  1. Check MikroTik connection: agentos doctor');
                console.log('  2. Verify port is free: lsof -i :' + port);
                console.log('  3. Review logs: cat logs/error.log\n');
                process.exit(1);
            }
        });

    // Subcommand: gateway status
    program
        .command('gateway:status')
        .alias('gs')
        .description('Check gateway status')
        .action(async () => {
            const { STATE_PATH } = global.AGENTOS;
            const pidFile = `${STATE_PATH}/gateway.pid`;

            if (!fs.existsSync(pidFile)) {
                console.log(chalk.red('✗ Gateway not running'));
                return;
            }

            try {
                const pid = fs.readFileSync(pidFile, 'utf8');
                process.kill(parseInt(pid), 0); // Check if alive
                console.log(chalk.green(`✓ Gateway running (PID: ${pid})`));
            } catch (e) {
                console.log(chalk.red('✗ Gateway not running (stale PID file)'));
                fs.unlinkSync(pidFile);
            }
        });

    // Subcommand: gateway stop
    program
        .command('gateway:stop')
        .description('Stop running gateway')
        .action(async () => {
            const { STATE_PATH } = global.AGENTOS;
            const pidFile = `${STATE_PATH}/gateway.pid`;

            if (!fs.existsSync(pidFile)) {
                console.log(chalk.yellow('⚠ Gateway not running'));
                return;
            }

            try {
                const pid = fs.readFileSync(pidFile, 'utf8');
                process.kill(parseInt(pid), 'SIGTERM');
                fs.unlinkSync(pidFile);
                console.log(chalk.green('✓ Gateway stopped'));
            } catch (e) {
                console.log(chalk.red(`✗ Error: ${e.message}`));
            }
        });
};