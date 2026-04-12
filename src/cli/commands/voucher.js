// ==========================================
// AGENTOS VOUCHER COMMAND
// Voucher management and generation
// ==========================================

const chalk = require('chalk');
const ora = require('ora');
const QRCode = require('qrcode');
const fs = require('fs');
const { getDatabase } = require('../../core/database');

module.exports = (program) => {
    const voucher = program
        .command('voucher')
        .description('Manage access vouchers')
        .alias('v');

    // Subcommand: voucher create
    voucher
        .command('create [plan]')
        .description('Create new voucher')
        .option('--duration <duration>', 'Duration (1h, 24h, 7d)', '1h')
        .option('--qty <n>', 'Quantity to generate', '1')
        .option('--qr', 'Generate QR code', false)
        .action(async (plan, options) => {
            const { BRAND, CONFIG_PATH } = global.AGENTOS;

            if (!fs.existsSync(CONFIG_PATH)) {
                console.log(chalk.red('✗ Run agentos onboard first'));
                return;
            }

            const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            const selectedPlan = plan || config.plans[0]?.name || 'default';

            const spinner = ora('Creating voucher...').start();

            try {
                const db = await getDatabase();
                const vouchers = [];

                for (let i = 0; i < parseInt(options.qty); i++) {
                    const code = `AGENT-${require('crypto').randomBytes(3).toString('hex').toUpperCase()}`;
                    await db.createVoucher(code, {
                        plan: selectedPlan,
                        duration: options.duration,
                        createdAt: new Date(),
                        createdBy: 'cli'
                    });

                    vouchers.push({ code, plan: selectedPlan });
                }

                spinner.succeed(`Created ${vouchers.length} voucher(s)`);

                console.log(chalk.cyan('\n🎟 Voucher Codes:\n'));

                for (const v of vouchers) {
                    console.log(chalk.bold(`  ${v.code}`));
                    console.log(chalk.gray(`  Plan: ${v.plan} | Duration: ${options.duration}`));

                    if (options.qr) {
                        const qrData = JSON.stringify({
                            code: v.code,
                            plan: v.plan,
                            url: `http://${config.mikrotik.ip}/login.html?code=${v.code}`
                        });

                        const qrPath = `${global.AGENTOS.STATE_PATH}/qr-${v.code}.png`;
                        await QRCode.toFile(qrPath, qrData);
                        console.log(chalk.gray(`  QR saved: ${qrPath}`));
                    }

                    console.log('');
                }

            } catch (error) {
                spinner.fail(chalk.red(`Failed: ${error.message}`));
            }
        });

    // Subcommand: voucher list
    voucher
        .command('list')
        .description('List recent vouchers')
        .option('--limit <n>', 'Number to show', '10')
        .option('--used', 'Show only used vouchers')
        .option('--active', 'Show only active vouchers')
        .action(async (options) => {
            try {
                const db = await getDatabase();
                const vouchers = await db.getRecentVouchers(parseInt(options.limit));

                let filtered = vouchers;
                if (options.used) filtered = vouchers.filter(v => v.used);
                if (options.active) filtered = vouchers.filter(v => !v.used);

                console.log(chalk.cyan(`\n📋 Vouchers (${filtered.length})\n`));

                filtered.forEach((v, i) => {
                    const status = v.used ? chalk.green('✓ Used') : chalk.yellow('○ Active');
                    const date = v.createdAt?.toDate?.() || v.createdAt;
                    console.log(`  ${i + 1}. ${v.id || v.code} | ${v.plan} | ${status}`);
                    console.log(`     Created: ${date}\n`);
                });

            } catch (error) {
                console.log(chalk.red(`Failed: ${error.message}`));
            }
        });

    // Subcommand: voucher revoke
    voucher
        .command('revoke <code>')
        .description('Revoke unused voucher')
        .action(async (code) => {
            try {
                const db = await getDatabase();
                const voucher = await db.getVoucher(code);

                if (!voucher) {
                    console.log(chalk.red('✗ Voucher not found'));
                    return;
                }

                if (voucher.used) {
                    console.log(chalk.yellow('⚠ Voucher already used - cannot revoke'));
                    return;
                }

                await db.deleteVoucher(code);
                console.log(chalk.green(`✓ Revoked voucher: ${code}`));

            } catch (error) {
                console.log(chalk.red(`Failed: ${error.message}`));
            }
        });

    // Subcommand: voucher stats
    voucher
        .command('stats')
        .description('Voucher statistics')
        .action(async () => {
            try {
                const db = await getDatabase();
                const stats = await db.getStats();

                console.log(chalk.cyan('\n📊 Voucher Statistics\n'));
                console.log(`  Total:  ${stats.total}`);
                console.log(`  Active: ${stats.active}`);
                console.log(`  Used:   ${stats.used}`);
                console.log(`  Rate:   ${stats.total > 0 ? Math.round((stats.used / stats.total) * 100) : 0}% redemption\n`);

            } catch (error) {
                console.log(chalk.red(`Failed: ${error.message}`));
            }
        });
};
