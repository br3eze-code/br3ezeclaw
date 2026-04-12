// src/core/agentPolicy.js 
'use strict';
/**
 * AgentPolicy — 5-dimension policy system
 */
class AgentPolicy {
  constructor(config) {
    this.rules = new PolicyEngine();
    
    // Network-specific policies
    this.rules.add('network', {
      'firewall.change': { approval: 'required', notify: ['admin'] },
      'user.kick': { approval: 'auto', rateLimit: '10/min' },
      'voucher.create': { approval: 'auto', maxValue: 100 }
    });
    
    // Developer-specific policies
    this.rules.add('developer', {
      'codegen.production': { approval: 'required', review: true },
      'deploy.production': { approval: 'required', tests: 'passing' },
      'git.push.main': { approval: 'required', checks: ['ci-passed'] },
      'infra.provision': { approval: 'required', budget: 500 }
    });
    
    // Cross-domain policies
    this.rules.add('cross-domain', {
      'deploy+firewall': { 
        autoApprove: true, // If deploy succeeds, firewall changes auto-approve
        rollbackOnFailure: true
      }
    });
  }
  
  evaluate(action, context) {
    const domain = action.domain;
    const policy = this.rules.get(domain, action.type);
    
    // Check cross-domain implications
    if (context.recentActions.length > 0) {
      const crossPolicy = this.rules.getCrossDomain(
        context.recentActions[context.recentActions.length - 1],
        action
      );
      if (crossPolicy) return crossPolicy;
    }
    
    return policy;
  }
}

// ── Enum values ──────────────────────────────────

const AgentPreset = Object.freeze({
    WORKER:     'worker',      
    SETUP:      'setup',       
    BROWSER:    'browser',     
    MONITORING: 'monitoring',  
    CUSTOM:     'custom'
});

const MissingToolBehavior = Object.freeze({
    FALLBACK:      'fallback',  
    ASK_SETUP:     'ask-setup', 
    ROUTE_SETUP:   'route-setup', 
    ALLOW_INSTALL: 'allow-install' 
});

const InstallScope = Object.freeze({
    NONE:      'none', 
    WORKSPACE: 'workspace', 
    SYSTEM:    'system'   
});

const FileAccess = Object.freeze({
    WORKSPACE_ONLY: 'workspace-only',
    EXTENDED:       'extended'        
});

const NetworkAccess = Object.freeze({
    RESTRICTED: 'restricted', 
    ENABLED:    'enabled'      
});

// ── Preset definitions ────────────────────────

const PRESET_POLICIES = {
    [AgentPreset.WORKER]: {
        preset:              AgentPreset.WORKER,
        missingToolBehavior: MissingToolBehavior.FALLBACK,
        installScope:        InstallScope.WORKSPACE,
        fileAccess:          FileAccess.WORKSPACE_ONLY,
        networkAccess:       NetworkAccess.RESTRICTED,
        label:               'Worker',
        emoji:               '🛠️',
        description:         'Standard hotspot ops — vouchers, users, monitoring.',
        tools:               ['users.active', 'users.all', 'user.add', 'user.remove', 'user.kick', 'system.stats', 'system.logs', 'ping']
    },
    [AgentPreset.SETUP]: {
        preset:              AgentPreset.SETUP,
        missingToolBehavior: MissingToolBehavior.ALLOW_INSTALL,
        installScope:        InstallScope.SYSTEM,
        fileAccess:          FileAccess.EXTENDED,
        networkAccess:       NetworkAccess.ENABLED,
        label:               'Setup / Operator',
        emoji:               '🧰',
        description:         'Router provisioning, bootstraps environments, full RouterOS access.',
        tools:               ['*'] // all tools
    },
    [AgentPreset.MONITORING]: {
        preset:              AgentPreset.MONITORING,
        missingToolBehavior: MissingToolBehavior.FALLBACK,
        installScope:        InstallScope.NONE,
        fileAccess:          FileAccess.WORKSPACE_ONLY,
        networkAccess:       NetworkAccess.RESTRICTED,
        label:               'Monitoring',
        emoji:               '📡',
        description:         'Read-only health polling — no mutations allowed.',
        tools:               ['system.stats', 'system.logs', 'users.active', 'ping', 'arp.table', 'dhcp.leases', 'interface.list']
    },
    [AgentPreset.CUSTOM]: {
        preset:              AgentPreset.CUSTOM,
        missingToolBehavior: MissingToolBehavior.ASK_SETUP,
        installScope:        InstallScope.WORKSPACE,
        fileAccess:          FileAccess.WORKSPACE_ONLY,
        networkAccess:       NetworkAccess.RESTRICTED,
        label:               'Custom',
        emoji:               '⚙️',
        description:         'Custom policy — configure manually.',
        tools:               []
    }
};

// ── Factory functions ──────────────────

function resolveAgentPolicy(preset = AgentPreset.WORKER) {
    return { ...PRESET_POLICIES[preset] ?? PRESET_POLICIES[AgentPreset.WORKER] };
}

function checkPolicyForTool(policy, toolName) {
    // Monitoring preset: only read tools
    if (policy.preset === AgentPreset.MONITORING) {
        const allowed = PRESET_POLICIES[AgentPreset.MONITORING].tools.includes(toolName);
        if (!allowed) return { allowed: false, reason: `Monitoring preset: tool '${toolName}' is not in read-only allow-list` };
    }

    // NetworkAccess: restricted blocks destructive network ops
    if (policy.networkAccess === NetworkAccess.RESTRICTED) {
        const networkDestructive = new Set(['system.reboot', 'firewall.block', 'firewall.unblock', 'traceroute']);
        if (networkDestructive.has(toolName)) {
            return { allowed: false, reason: `networkAccess=restricted: tool '${toolName}' requires enabled network access` };
        }
    }

    // InstallScope: none blocks any config mutation
    if (policy.installScope === InstallScope.NONE) {
        const mutations = new Set(['user.add', 'user.remove', 'user.kick', 'system.reboot', 'firewall.block', 'firewall.unblock']);
        if (mutations.has(toolName)) {
            return { allowed: false, reason: `installScope=none: tool '${toolName}' would mutate router config` };
        }
    }

    // FileAccess: workspace-only restricts to hotspot namespace
    if (policy.fileAccess === FileAccess.WORKSPACE_ONLY) {
        const extendedTools = new Set(['interface.list', 'arp.table', 'traceroute', 'system.reboot']);
        if (extendedTools.has(toolName)) {
            return { allowed: false, reason: `fileAccess=workspace-only: tool '${toolName}' requires extended router access` };
        }
    }

    return { allowed: true };
}

function inferPresetFromDescription(description = '') {
    const lower = description.toLowerCase();
    if (/provision|install|setup|bootstrap|configure/.test(lower)) return AgentPreset.SETUP;
    if (/monitor|health|check|watch|poll|alert/.test(lower)) return AgentPreset.MONITORING;
    return AgentPreset.WORKER;
}

const HEARTBEAT_INTERVALS = {
    '15m':  15 * 60 * 1000,
    '30m':  30 * 60 * 1000,
    '60m':  60 * 60 * 1000,
    '240m': 240 * 60 * 1000
};
const DEFAULT_HEARTBEAT_INTERVAL = '30m';

function resolveHeartbeat(preset, heartbeatConfig = null) {
    const defaults = {
        enabled: preset === AgentPreset.MONITORING,
        every:   DEFAULT_HEARTBEAT_INTERVAL
    };
    if (!heartbeatConfig) return defaults;
    return {
        enabled: typeof heartbeatConfig.enabled === 'boolean' ? heartbeatConfig.enabled : defaults.enabled,
        every:   heartbeatConfig.every || defaults.every
    };
}

function heartbeatIntervalMs(every = DEFAULT_HEARTBEAT_INTERVAL) {
    return HEARTBEAT_INTERVALS[every] || HEARTBEAT_INTERVALS[DEFAULT_HEARTBEAT_INTERVAL];
}

module.exports = {
    AgentPreset, MissingToolBehavior, InstallScope, FileAccess, NetworkAccess,
    resolveAgentPolicy, checkPolicyForTool, inferPresetFromDescription,
    resolveHeartbeat, heartbeatIntervalMs,
    PRESET_POLICIES, HEARTBEAT_INTERVALS, DEFAULT_HEARTBEAT_INTERVAL
};
