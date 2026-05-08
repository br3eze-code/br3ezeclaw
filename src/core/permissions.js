'use strict';
/**
 * Permission System — PermissionContext + PermissionEnforcer
 */

// ── Permission Modes ──────────────────────────────────────────────────────────

const PermissionMode = Object.freeze({
    PLAN:   'plan',  
    PROMPT: 'prompt', 
    AUTO:   'auto'    
});

// ── Tool tier classification ──────────────────────────────────────────────────

const TOOL_TIERS = {
    plan: new Set([
        'system.stats', 'system.logs', 'users.active', 'users.all',
        'user.status', 'ping', 'traceroute', 'firewall.list',
        'dhcp.leases', 'interface.list', 'arp.table'
    ]),
    destructive: new Set([
        'system.reboot', 'user.remove', 'user.kick',
        'firewall.block', 'firewall.unblock'
    ])
};

function requiredModeFor(toolName) {
    if (TOOL_TIERS.plan.has(toolName))        return PermissionMode.PLAN;
    if (TOOL_TIERS.destructive.has(toolName)) return PermissionMode.AUTO;
    return PermissionMode.PROMPT; // default: creation/mutation tools
}

// ── ToolPermissionContext ─────────────────────────────────────────────────────

class ToolPermissionContext {
    constructor({ denyNames = [], denyPrefixes = [] } = {}) {
        this.denyNames    = new Set(denyNames.map(n => n.toLowerCase()));
        this.denyPrefixes = denyPrefixes.map(p => p.toLowerCase());
    }
    blocks(toolName) {
        const lc = toolName.toLowerCase();
        if (this.denyNames.has(lc)) return true;
        return this.denyPrefixes.some(prefix => lc.startsWith(prefix));
    }

    static fromConfig(config = {}) {
        return new ToolPermissionContext({
            denyNames:    config.denyTools     || [],
            denyPrefixes: config.denyPrefixes  || []
        });
    }
}

// ── PermissionEnforcer ────────────────────────────────────────────────────────

class PermissionEnforcer {
    constructor(activeMode = PermissionMode.PROMPT, permissionContext = null) {
        this.activeMode         = activeMode;
        this.permissionContext  = permissionContext || new ToolPermissionContext();
    }

    check(toolName, params = {}) {
        const requiredMode = requiredModeFor(toolName);

        if (this.permissionContext.blocks(toolName)) {
            return {
                allowed:      false,
                reason:       `Tool '${toolName}' is on the deny list`,
                activeMode:   this.activeMode,
                requiredMode
            };
        }

        if (this.activeMode === PermissionMode.PLAN && requiredMode !== PermissionMode.PLAN) {
            return {
                allowed:      false,
                reason:       `Tool '${toolName}' requires '${requiredMode}' mode but agent is in 'plan' mode`,
                activeMode:   this.activeMode,
                requiredMode
            };
        }
        if (this.activeMode === PermissionMode.PROMPT) {
            return { allowed: true, requiresConfirmation: requiredMode !== PermissionMode.PLAN, activeMode: this.activeMode, requiredMode };
        }

        return { allowed: true, activeMode: this.activeMode, requiredMode };
    }

    isAllowed(toolName, params = {}) {
        return this.check(toolName, params).allowed;
    }
}

// ── PermissionDenial record ───────────────────────────────────────────────────

class PermissionDenial {
    constructor(toolName, reason) {
        this.toolName  = toolName;
        this.reason    = reason;
        this.timestamp = new Date().toISOString();
    }
    toJSON() { return { toolName: this.toolName, reason: this.reason, timestamp: this.timestamp }; }
}

module.exports = { PermissionMode, PermissionEnforcer, ToolPermissionContext, PermissionDenial, requiredModeFor, TOOL_TIERS };
