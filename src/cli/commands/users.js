// ==========================================
// AGENTOS USERS COMMAND
// Hotspot user management
// ==========================================

const _chalk = require('chalk');
const chalk  = _chalk.default || _chalk;
const _ora = require('ora');
const ora = _ora.default || _ora;
const { getMikroTikClient } = require('../../core/mikrotik');

module.exports = (program) => {
    const users = program
        .command('users')
        .description('Manage hotspot users')
        .alias('user');

    // Subcommand: users list
    users
        .command('list')
        .description('List active hotspot users')
        .option('--all, -a', 'Show all users (not just active)')
        .option('--limit, -l <n>', 'Limit results', '20')
        .action(async (options) => {
            try {
                const mikrotik = await getMikroTikClient();

                if (options.all) {
                    const allUsers = await mikrotik.getAllHotspotUsers();
                    console.log(chalk.cyan(`\n📋 All Hotspot Users (${allUsers.length})\n`));

                    allUsers.slice(0, parseInt(options.limit)).forEach((user, i) => {
                        const status = user.disabled === 'yes' ? chalk.red('disabled') : chalk.green('enabled');
                        console.log(`  ${i + 1}. ${user.name} (${user.profile}) - ${status}`);
                    });
                } else {
                    const activeUsers = await mikrotik.getActiveUsers();
                    console.log(chalk.cyan(`\n👥 Active Users (${activeUsers.length})\n`));

                    if (activeUsers.length === 0) {
                        console.log(chalk.gray('  No active users'));
                        return;
                    }

                    activeUsers.forEach((user, i) => {
                        const dataIn = formatBytes(user['bytes-in'] || 0);
                        const dataOut = formatBytes(user['bytes-out'] || 0);

                        console.log(`  ${i + 1}. ${chalk.bold(user.user)}`);
                        console.log(`     IP: ${user.address} | MAC: ${user['mac-address']}`);
                        console.log(`     Uptime: ${user.uptime} | Data: ↓${dataIn} ↑${dataOut}\n`);
                    });
                }

            } catch (error) {
                console.log(chalk.red(`Failed: ${error.message}`));
            }
        });

    // Subcommand: users kick
    users
        .command('kick <username>')
        .description('Disconnect active user')
        .action(async (username) => {
            const spinner = ora(`Kicking ${username}...`).start();

            try {
                const mikrotik = await getMikroTikClient();
                const kicked = await mikrotik.kickUser(username);

                if (kicked) {
                    spinner.succeed(chalk.green(`✓ User ${username} kicked`));
                } else {
                    spinner.warn(chalk.yellow(`User ${username} not active`));
                }

            } catch (error) {
                spinner.fail(chalk.red(`Failed: ${error.message}`));
            }
        });

    // Subcommand: users add
    users
        .command('add <username> [password]')
        .description('Add hotspot user')
        .option('--profile <profile>', 'User profile/plan', 'default')
        .action(async (username, password, options) => {
            const pass = password || username; // Default password = username

            try {
                const mikrotik = await getMikroTikClient();
                await mikrotik.addHotspotUser(username, pass, options.profile);
                console.log(chalk.green(`✓ Created user: ${username} (profile: ${options.profile})`));
            } catch (error) {
                console.log(chalk.red(`Failed: ${error.message}`));
            }
        });

    // Subcommand: users remove
    users
        .command('remove <username>')
        .description('Remove hotspot user')
        .option('--force, -f', 'Force removal even if active')
        .action(async (username, options) => {
            try {
                const mikrotik = await getMikroTikClient();

                if (!options.force) {
                    const active = await mikrotik.getUserStatus(username);
                    if (active) {
                        console.log(chalk.yellow(`⚠ User ${username} is currently active. Use --force to remove anyway.`));
                        return;
                    }
                }

                await mikrotik.removeHotspotUser(username);
                console.log(chalk.green(`✓ Removed user: ${username}`));

            } catch (error) {
                console.log(chalk.red(`Failed: ${error.message}`));
            }
        });

    // Subcommand: users status
    users
        .command('status <username>')
        .description('Check user connection status')
        .action(async (username) => {
            try {
                const mikrotik = await getMikroTikClient();
                const status = await mikrotik.getUserStatus(username);

                if (status) {
                    console.log(chalk.green(`\n✓ ${username} is ONLINE\n`));
                    console.log(`  IP: ${status.address}`);
                    console.log(`  MAC: ${status['mac-address']}`);
                    console.log(`  Uptime: ${status.uptime}`);
                    console.log(`  Data: ↓${formatBytes(status['bytes-in'] || 0)} ↑${formatBytes(status['bytes-out'] || 0)}`);
                } else {
                    console.log(chalk.yellow(`\n○ ${username} is OFFLINE\n`));
                }

            } catch (error) {
                console.log(chalk.red(`Failed: ${error.message}`));
            }
        });
};

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
