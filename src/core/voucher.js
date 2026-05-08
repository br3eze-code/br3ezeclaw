'use strict';
/**
 * VoucherAgent — Voucher generation & event emission
 * @module core/voucher
 * @version 2026.04.23
 */

const eventBus  = require('../core/eventBus');
const { getConfig } = require('./config');

class VoucherAgent {
    constructor() {
        // We load config on demand to ensure we have the latest environment overrides
    }

    get _config() {
        const config = getConfig();
        return config.vouchers || config.tools?.voucher || {
            prefix: 'STAR',
            format: 'XXXX-XXXX',
            alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        };
    }

    get _validPlans() {
        const config = getConfig();
        // Canonical hardcoded aliases — both display name style AND mikrotikProfile style
        const plans = new Set(['default', '1hour', '1day', '1week', '30day', '7day', '1month']);
        
        // Dynamically add plans from MikroTik profiles
        const profiles = config.tools?.mikrotik?.profiles;
        if (Array.isArray(profiles)) {
            profiles.forEach(p => {
                if (p.name) plans.add(p.name);
                if (p.mikrotikProfile) plans.add(p.mikrotikProfile);
            });
        }
        
        // Also add plans from top-level config (used by onboard wizard)
        // Add BOTH the display name and the mikrotikProfile identifier
        if (Array.isArray(config.plans)) {
            config.plans.forEach(p => {
                if (p.name) plans.add(p.name);
                if (p.mikrotikProfile) plans.add(p.mikrotikProfile);
            });
        }
        
        return plans;
    }
    
    generate(plan = 'default') {
        const validPlans = this._validPlans;
        let matchedPlan = plan;
        if (!validPlans.has(plan)) {
            // Attempt case-insensitive match
            const lowerPlan = plan.toLowerCase();
            let found = false;
            for (const valid of validPlans) {
                if (valid.toLowerCase() === lowerPlan) {
                    matchedPlan = valid;
                    found = true;
                    break;
                }
            }
            if (!found) {
                throw new Error(`Invalid plan '${plan}'. Available: ${[...validPlans].join(', ')}`);
            }
        }
        plan = matchedPlan;

        const config = this._config;
        const chars = config.alphabet || config.charset || 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        
        const genPart = (len = 4) => {
            let s = '';
            for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
            return s;
        };

        // If format is like XXXX-XXXX, we replace groups of X with genPart
        const format = config.format || 'XXXX-XXXX';
        let codePart = format.replace(/X+/g, (m) => genPart(m.length));
        
        const prefix = config.prefix || 'STAR';
        const code = `${prefix}-${codePart}`;

        eventBus.emit('voucher.created', { code, plan, createdAt: new Date().toISOString() });
        return code;
    }
    
    async createVoucher(plan = 'default') {
        const code = this.generate(plan);
        const password = code; // Using code as password for simplicity in hotspots
        
        // Provision to MikroTik if available
        let loginUrl = '';
        if (global.mikrotik && global.mikrotik.isConnected) {
            try {
                loginUrl = await global.mikrotik.executeTool('user.add', {
                    username: code,
                    password: password,
                    profile: plan
                });
            } catch (err) {
                console.error(`[Voucher] MikroTik provisioning failed for ${code}: ${err.message}`);
            }
        } else {
            console.warn('[Voucher] MikroTik not connected — voucher generated but not provisioned to router.');
        }
        
        // Return structured voucher data for printing/response
        return {
            username: code,
            password: password,
            profile: plan,
            loginUrl: loginUrl || `http://hotspot.local/login?username=${code}&password=${password}`,
            createdAt: new Date().toISOString()
        };
    }

    redeem(code, user) {
        if (!code || !user) throw new Error('code and user are required');
        eventBus.emit('voucher.redeemed', { code, user, redeemedAt: new Date().toISOString() });
    }
}

module.exports = new VoucherAgent();
