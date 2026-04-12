// ==========================================
// AGENTOS STATUS COMMAND
// Quick system overview
// ==========================================

const chalk = require('chalk');
const fs = require('fs');

module.exports = (program) => {

        program
  .command('dashboard')
  .description('Show dashboard overview')
  .action(async () => {
    // Aggregate data from multiple sources
    const mikrotik = await getMikroTikClient();
    const [stats, activeUsers] = await Promise.all([
      mikrotik.getSystemStats(),
      mikrotik.getActiveUsers()
    ]);
    
    console.log(chalk.cyan('\n📊 Dashboard\n'));
    console.log(`CPU: ${stats['cpu-load']}% | Uptime: ${stats.uptime}`);
    console.log(`Active Users: ${activeUsers.length}`);
  });
    program
        .command('status')
        .description('Show system status')
        .alias('s')
        .action(async () => {
            const { BRAND, CONFIG_PATH, STATE_PATH } = global.AGENTOS;

            console.log(chalk.cyan(`\n${BRAND.emoji} ${BRAND.name} Status\n`));

            // Config info
            if (fs.existsSync(CONFIG_PATH)) {
                const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
                console.log(chalk.gray('Profile:'), global.AGENTOS.PROFILE_DIR);
                console.log(chalk.gray('Version:'), cfg.version);
                console.log(chalk.gray('Created:'), new Date(cfg.createdAt).toLocaleDateString());
            } else {
                console.log(chalk.yellow('⚠ Not configured - run: agentos onboard'));
                return;
            }

            // Gateway status
            const pidFile = `${STATE_PATH}/gateway.pid`;
            let gatewayStatus = chalk.red('stopped');
            if (fs.existsSync(pidFile)) {
                try {
                    const pid = fs.readFileSync(pidFile, 'utf8');
                    process.kill(parseInt(pid), 0);
                    gatewayStatus = chalk.green(`running (PID: ${pid})`);
                } catch (e) {
                    gatewayStatus = chalk.yellow('stale PID file');
                }
            }
            console.log(chalk.gray('Gateway:'), gatewayStatus);

            // MikroTik status
            try {
                const { getMikroTikClient } = require('../../core/mikrotik');
                const mikrotik = await getMikroTikClient();
             const stats = await mikrotik.getSystemStats();
const cpuLoad = stats?.['cpu-load'] || stats?.['cpu-load'] || 'N/A';
console.log(chalk.gray('Router:'), chalk.green(`connected (${cpuLoad}% CPU)`));
            } catch (e) {
                console.log(chalk.gray('Router:'), chalk.red('disconnected'));
            }

            console.log('');
        });
};
