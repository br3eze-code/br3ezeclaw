// ==========================================
// AGENTOS STATUS COMMAND
// Quick system overview
// ==========================================

const chalk = require('chalk');
const fs = require('fs');

module.exports = (program) => {
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
                console.log(chalk.gray('Router:'), chalk.green(`connected (${stats['cpu-load']}% CPU)`));
            } catch (e) {
                console.log(chalk.gray('Router:'), chalk.red('disconnected'));
            }

            console.log('');
        });
};