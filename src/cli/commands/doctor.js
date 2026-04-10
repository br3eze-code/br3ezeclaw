// ==========================================
// AGENTOS DOCTOR COMMAND
// Health checks and diagnostics
// ==========================================

const chalk = require('chalk');
const ora = require('ora');
const { execSync } = require('child_process');
const fs = require('fs');

module.exports = (program) => {
    program
        .command('doctor')
        .description('Health checks and quick fixes')
        .option('--fix', 'Auto-repair issues')
        .option('--deep', 'Deep system scan')
        .action(async (options) => {
            const { BRAND, CONFIG_PATH, STATE_PATH } = global.AGENTOS;

            console.log(chalk.cyan(`\n🔧 ${BRAND.name} Health Check\n`));

            const checks = [];

            // Check 1: Configuration
            const configCheck = ora('Checking configuration...').start();
            if (fs.existsSync(CONFIG_PATH)) {
                try {
                    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
                    configCheck.succeed('Configuration valid');
                    checks.push({ name: 'Config', status: 'ok', details: config.version });
                } catch (e) {
                    configCheck.fail('Configuration corrupted');
                    checks.push({ name: 'Config', status: 'error', details: e.message });
                }
            } else {
                configCheck.fail('No configuration found');
                checks.push({ name: 'Config', status: 'error', details: 'Run agentos onboard' });
            }

            // Check 2: MikroTik Connection
            const mtCheck = ora('Testing MikroTik connection...').start();
            try {
                const { testMikroTikConnection } = require('../../core/mikrotik');
                const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
                await testMikroTikConnection(config.mikrotik);
                mtCheck.succeed('MikroTik connected');
                checks.push({ name: 'MikroTik', status: 'ok', details: config.mikrotik.ip });
            } catch (e) {
                mtCheck.fail(`MikroTik error: ${e.message}`);
                checks.push({ name: 'MikroTik', status: 'error', details: e.message });
            }

            // Check 3: Gateway Status
            const gwCheck = ora('Checking gateway...').start();
            const pidFile = `${STATE_PATH}/gateway.pid`;
            if (fs.existsSync(pidFile)) {
                try {
                    const pid = fs.readFileSync(pidFile, 'utf8');
                    process.kill(parseInt(pid), 0);
                    gwCheck.succeed(`Gateway running (PID: ${pid})`);
                    checks.push({ name: 'Gateway', status: 'ok', details: `PID ${pid}` });
                } catch (e) {
                    gwCheck.warn('Gateway not running (stale PID file)');
                    checks.push({ name: 'Gateway', status: 'warn', details: 'Not running' });

                    if (options.fix) {
                        fs.unlinkSync(pidFile);
                        console.log(chalk.gray('  ✓ Cleaned up stale PID file'));
                    }
                }
            } else {
                gwCheck.warn('Gateway not running');
                checks.push({ name: 'Gateway', status: 'warn', details: 'Not running' });
            }

            // Check 4: Dependencies (deep scan)
            if (options.deep) {
                const depCheck = ora('Checking dependencies...').start();
                const deps = ['node', 'npm'];
                const missing = [];

                deps.forEach(dep => {
                    try {
                        execSync(`which ${dep}`, { stdio: 'pipe' });
                    } catch (e) {
                        missing.push(dep);
                    }
                });

                if (missing.length === 0) {
                    depCheck.succeed('All dependencies present');
                    checks.push({ name: 'Dependencies', status: 'ok' });
                } else {
                    depCheck.fail(`Missing: ${missing.join(', ')}`);
                    checks.push({ name: 'Dependencies', status: 'error', details: missing.join(', ') });
                }
            }

            // Summary
            console.log(chalk.cyan('\n📋 Summary:\n'));

            const errors = checks.filter(c => c.status === 'error').length;
            const warnings = checks.filter(c => c.status === 'warn').length;
            const ok = checks.filter(c => c.status === 'ok').length;

            checks.forEach(check => {
                const icon = check.status === 'ok' ? chalk.green('✓') :
                    check.status === 'warn' ? chalk.yellow('⚠') : chalk.red('✗');
                console.log(`  ${icon} ${check.name.padEnd(15)} ${check.details || ''}`);
            });

            console.log('');
            if (errors === 0 && warnings === 0) {
                console.log(chalk.green('✓ All systems operational'));
            } else if (errors === 0) {
                console.log(chalk.yellow(`⚠ ${warnings} warning(s) - review above`));
            } else {
                console.log(chalk.red(`✗ ${errors} error(s), ${warnings} warning(s)`));
                if (!options.fix) {
                    console.log(chalk.gray('\nRun with --fix to auto-repair issues'));
                }
            }

            console.log('');
        });
};