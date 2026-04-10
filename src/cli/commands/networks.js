// ==========================================
// AGENTOS NETWORK COMMAND
// Network diagnostics and management
// ==========================================

const chalk = require('chalk');
const ora = require('ora');
const { getMikroTikClient } = require('../../core/mikrotik');

module.exports = (program) => {
    const network = program
        .command('network')
        .description('Network diagnostics and RouterOS tools')
        .alias('net');

    // Subcommand: network ping
    network
        .command('ping <host>')
        .description('Ping test from router')
        .option('--count, -c <n>', 'Number of pings', '4')
        .action(async (host, options) => {
            const spinner = ora(`Pinging ${host}...`).start();

            try {
                const mikrotik = await getMikroTikClient();
                const result = await mikrotik.ping(host, parseInt(options.count));

                spinner.stop();

                console.log(chalk.cyan(`\n📡 Ping Results: ${host}\n`));
                result.forEach((r, i) => {
                    const status = r.received > 0 ? chalk.green('✓') : chalk.red('✗');
                    console.log(`  ${status} Hop ${i + 1}: ${r.host} - ${r.time || 'timeout'}`);
                });

            } catch (error) {
                spinner.fail(chalk.red(`Failed: ${error.message}`));
            }
        });

    // Subcommand: network scan
    network
        .command('scan')
        .description('Scan for connected devices')
        .action(async () => {
            const spinner = ora('Scanning network...').start();

            try {
                const mikrotik = await getMikroTikClient();
                const leases = await mikrotik.getDhcpLeases();

                spinner.succeed(`Found ${leases.length} devices`);

                console.log(chalk.cyan('\n📋 Connected Devices:\n'));
                leases.forEach(lease => {
                    const status = lease.status === 'bound' ? chalk.green('●') : chalk.gray('○');
                    console.log(`  ${status} ${lease.hostName || 'Unknown'} (${lease.macAddress})`);
                    console.log(`     IP: ${lease.address} | Expires: ${lease.expiresAfter}\n`);
                });

            } catch (error) {
                spinner.fail(chalk.red(`Failed: ${error.message}`));
            }
        });

    // Subcommand: network firewall
    network
        .command('firewall')
        .description('Show firewall rules')
        .option('--type <type>', 'Rule type (filter|nat|mangle)', 'filter')
        .action(async (options) => {
            try {
                const mikrotik = await getMikroTikClient();
                const rules = await mikrotik.getFirewallRules(options.type);

                console.log(chalk.cyan(`\n🔥 Firewall Rules (${options.type}): ${rules.length}\n`));

                rules.slice(0, 10).forEach((rule, i) => {
                    const action = rule.action === 'drop' ? chalk.red(rule.action) : chalk.green(rule.action);
                    console.log(`  ${i + 1}. [${rule.chain}] ${action}`);
                    if (rule.comment) console.log(`     Comment: ${rule.comment}`);
                    console.log('');
                });

                if (rules.length > 10) {
                    console.log(chalk.gray(`  ... and ${rules.length - 10} more rules`));
                }

            } catch (error) {
                console.log(chalk.red(`Failed: ${error.message}`));
            }
        });

    // Subcommand: network block
    network
        .command('block <target>')
        .description('Block IP or MAC address')
        .option('--reason <reason>', 'Block reason', 'Manual block')
        .action(async (target, options) => {
            try {
                const mikrotik = await getMikroTikClient();
                await mikrotik.addToBlockList(target, options.reason);
                console.log(chalk.green(`✓ Blocked: ${target}`));
            } catch (error) {
                console.log(chalk.red(`Failed: ${error.message}`));
            }
        });

    // Subcommand: network unblock
    network
        .command('unblock <target>')
        .description('Unblock IP or MAC address')
        .action(async (target) => {
            try {
                const mikrotik = await getMikroTikClient();
                await mikrotik.removeFromBlockList(target);
                console.log(chalk.green(`✓ Unblocked: ${target}`));
            } catch (error) {
                console.log(chalk.red(`Failed: ${error.message}`));
            }
        });
};