#!/usr/bin/env node
/**
 * AgentOS Onboarding Runner
 * This script serves as the primary entry point for onboarding new routers.
 * It uses the core onboarding service to apply templates and provision agents.
 */

require('dotenv').config();
const { onboardRouter, provisionAgents } = require('./src/core/onboard');
const { logger } = require('./src/core/logger');

async function main() {
    const args = process.argv.slice(2);
    const host = args[0] || process.env.MIKROTIK_HOST || process.env.MIKROTIK_IP || '192.168.88.1';
    const user = process.env.MIKROTIK_USER || 'admin';
    const password = process.env.MIKROTIK_PASSWORD || process.env.MIKROTIK_PASS || '';
    const port = process.env.MIKROTIK_PORT || 8728;

    const isDebug = args.includes('--debug');
    const isDryRun = args.includes('--dry-run') || isDebug;
    const skipProvision = args.includes('--no-provision');

    logger.info(`--- AgentOS Onboarding [${isDebug ? 'DEBUG' : 'START'}] ---`);
    logger.info(`Target: ${host}:${port} (${user})`);

    const options = {
        host,
        user,
        password,
        port,
        dryRun: isDryRun,
        // Map common .env names to template variables
        AGENTOS_NODE_URL: process.env.AGENTOS_NODE_URL || process.env.SERVER_URL || 'http://hotspot.local',
        FIREBASE_URL: process.env.FIREBASE_URL || process.env.FIREBASE_DATABASE_URL,
        FIREBASE_API_KEY: process.env.FIREBASE_API_KEY || 'AIzaSy_DEFAULT_KEY',
        TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN,
        TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || (process.env.ALLOWED_CHAT_IDS ? process.env.ALLOWED_CHAT_IDS.split(',')[0] : ''),
        
        // Router Passwords - Use ENV or defaults
        AGENTOS_API_PASSWORD: process.env.AGENTOS_API_PASSWORD || 'AgentOS_API_123!',
        AGENTOS_ADMIN_PASSWORD: process.env.AGENTOS_ADMIN_PASSWORD || 'AgentOS_Admin_123!',
        AGENTOS_OPERATOR_PASSWORD: process.env.AGENTOS_OPERATOR_PASSWORD || 'AgentOS_Op_123!',
        AGENTOS_READONLY_PASSWORD: process.env.AGENTOS_READONLY_PASSWORD || 'AgentOS_RO_123!',
        BACKUP_PASSWORD: process.env.BACKUP_PASSWORD || 'AgentOS_Backup_123!'
    };

    if (isDebug) {
        logger.info("DEBUG MODE: Printing templated variables:");
        console.log(JSON.stringify(options, null, 2));
        
        // Verify we can load the core module
        try {
            const { templateRsc } = require('./src/core/onboard');
            const fs = require('fs/promises');
            const path = require('path');
            
            const files = ['setup.rsc', 'mikro.rsc', 'agentos-sentinel.rsc'];
            for (const file of files) {
                try {
                    const content = await fs.readFile(path.join(process.cwd(), file), 'utf8');
                    const templated = templateRsc(content, options);
                    logger.info(`--- Templated ${file} ---`);
                    console.log(templated.substring(0, 500) + '...'); // Print snippet
                } catch (e) {
                    logger.warn(`Could not read ${file}: ${e.message}`);
                }
            }
        } catch (e) {
            logger.error(`Debug error: ${e.message}`);
        }
        return;
    }

    const result = await onboardRouter(options);


    if (result.success) {
        logger.info(`Onboarding successful!`);
        
        if (!skipProvision) {
            // Provision an agent for this router
            const routerId = host.replace(/\./g, '-'); // Simple ID generation
            const agentResult = await provisionAgents(routerId, options);
            
            if (agentResult.success) {
                logger.info(`Agent provisioned: ${agentResult.id}`);
            } else {
                logger.warn(`Agent provisioning failed: ${agentResult.error}`);
            }
        }
    } else {
        logger.error(`Onboarding failed: ${result.error}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}
