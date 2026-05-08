const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { getDatabase } = require('../src/core/database');
const { MikroTikManager } = require('../src/core/mikrotik');
const UniversalBilling = require('../src/core/universal-billing');
const { logger } = require('../src/core/logger');

async function main() {
    logger.info('Starting Ghost Session Audit...');

    const db = await getDatabase();

    const mikrotik = new MikroTikManager();
    await mikrotik.connect();

    const billing = new UniversalBilling({
        database: db,
        mikrotik: mikrotik
    });

    try {
        const report = await billing.auditGhostSessions();
        
        console.log('\n--- Ghost Session Audit Report ---');
        console.log(`Timestamp: ${report.timestamp}`);
        console.log(`Total Checked: ${report.totalChecked}`);
        console.log(`Valid Sessions: ${report.valid.length}`);
        console.log(`Ghost Sessions: ${report.ghosts.length}`);

        if (report.ghosts.length > 0) {
            console.log('\nGhosts Found:');
            report.ghosts.forEach((ghost, index) => {
                console.log(`  ${index + 1}. Username: ${ghost.username}`);
                console.log(`     Profile: ${ghost.profile}`);
                console.log(`     Is Active: ${ghost.isActive}`);
                console.log(`     Disabled: ${ghost.disabled}`);
                console.log(`     Uptime: ${ghost.uptime}`);
                console.log(`     Bytes Total: ${ghost.bytesTotal}`);
            });
        } else {
            console.log('\nNo ghost sessions detected. The router and database are in sync.');
        }
        console.log('----------------------------------\n');

    } catch (error) {
        logger.error('Audit failed', { error: error.message });
    } finally {
        if (mikrotik && typeof mikrotik.destroy === 'function') {
            mikrotik.destroy();
        }
        process.exit(0);
    }
}

main().catch(console.error);
