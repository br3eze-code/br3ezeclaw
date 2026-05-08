'use strict';

const {
    PermissionMode,
    PermissionEnforcer,
    ToolPermissionContext,
    PermissionDenial,
    requiredModeFor,
    TOOL_TIERS
} = require('../../src/core/permissions');

// ── PermissionMode ────────────────────────────────────────────────────────────

describe('PermissionMode', () => {
    test('has exactly three modes', () => {
        expect(Object.keys(PermissionMode)).toHaveLength(3);
    });

    test('modes have correct string values', () => {
        expect(PermissionMode.PLAN).toBe('plan');
        expect(PermissionMode.PROMPT).toBe('prompt');
        expect(PermissionMode.AUTO).toBe('auto');
    });

    test('is frozen — cannot be mutated', () => {
        expect(() => { PermissionMode.PLAN = 'hacked'; }).toThrow();
        expect(PermissionMode.PLAN).toBe('plan');
    });
});

// ── requiredModeFor ───────────────────────────────────────────────────────────

describe('requiredModeFor', () => {
    test('read-only tools require PLAN mode', () => {
        const planTools = ['system.stats', 'system.logs', 'users.active', 'users.all',
            'user.status', 'ping', 'traceroute', 'firewall.list', 'dhcp.leases',
            'interface.list', 'arp.table'];
        for (const tool of planTools) {
            expect(requiredModeFor(tool)).toBe(PermissionMode.PLAN);
        }
    });

    test('destructive tools require AUTO mode', () => {
        const destructiveTools = ['system.reboot', 'user.remove', 'user.kick',
            'firewall.block', 'firewall.unblock'];
        for (const tool of destructiveTools) {
            expect(requiredModeFor(tool)).toBe(PermissionMode.AUTO);
        }
    });

    test('unknown tools default to PROMPT mode', () => {
        expect(requiredModeFor('user.add')).toBe(PermissionMode.PROMPT);
        expect(requiredModeFor('custom.tool')).toBe(PermissionMode.PROMPT);
        expect(requiredModeFor('unknown')).toBe(PermissionMode.PROMPT);
    });
});

// ── TOOL_TIERS ────────────────────────────────────────────────────────────────

describe('TOOL_TIERS', () => {
    test('plan tier is a Set', () => {
        expect(TOOL_TIERS.plan).toBeInstanceOf(Set);
    });

    test('destructive tier is a Set', () => {
        expect(TOOL_TIERS.destructive).toBeInstanceOf(Set);
    });

    test('tiers do not overlap', () => {
        const intersection = [...TOOL_TIERS.plan].filter(t => TOOL_TIERS.destructive.has(t));
        expect(intersection).toHaveLength(0);
    });

    test('plan tier contains expected tools', () => {
        expect(TOOL_TIERS.plan.has('system.stats')).toBe(true);
        expect(TOOL_TIERS.plan.has('ping')).toBe(true);
        expect(TOOL_TIERS.plan.has('arp.table')).toBe(true);
    });

    test('destructive tier contains expected tools', () => {
        expect(TOOL_TIERS.destructive.has('system.reboot')).toBe(true);
        expect(TOOL_TIERS.destructive.has('user.remove')).toBe(true);
        expect(TOOL_TIERS.destructive.has('firewall.block')).toBe(true);
    });
});

// ── ToolPermissionContext ─────────────────────────────────────────────────────

describe('ToolPermissionContext', () => {
    test('blocks exact tool name match (case-insensitive)', () => {
        const ctx = new ToolPermissionContext({ denyNames: ['user.remove', 'System.Reboot'] });
        expect(ctx.blocks('user.remove')).toBe(true);
        expect(ctx.blocks('USER.REMOVE')).toBe(true);
        expect(ctx.blocks('system.reboot')).toBe(true);
        expect(ctx.blocks('user.add')).toBe(false);
    });

    test('blocks tools by prefix', () => {
        const ctx = new ToolPermissionContext({ denyPrefixes: ['firewall.', 'system.'] });
        expect(ctx.blocks('firewall.block')).toBe(true);
        expect(ctx.blocks('firewall.list')).toBe(true);
        expect(ctx.blocks('system.reboot')).toBe(true);
        expect(ctx.blocks('user.add')).toBe(false);
        expect(ctx.blocks('ping')).toBe(false);
    });

    test('blocks nothing by default', () => {
        const ctx = new ToolPermissionContext();
        expect(ctx.blocks('system.reboot')).toBe(false);
        expect(ctx.blocks('user.remove')).toBe(false);
    });

    test('fromConfig builds correctly from config object', () => {
        const ctx = ToolPermissionContext.fromConfig({
            denyTools:    ['user.kick'],
            denyPrefixes: ['custom.']
        });
        expect(ctx.blocks('user.kick')).toBe(true);
        expect(ctx.blocks('custom.anything')).toBe(true);
        expect(ctx.blocks('ping')).toBe(false);
    });

    test('fromConfig returns empty context for empty config', () => {
        const ctx = ToolPermissionContext.fromConfig({});
        expect(ctx.blocks('system.reboot')).toBe(false);
    });
});

// ── PermissionEnforcer ────────────────────────────────────────────────────────

describe('PermissionEnforcer — PLAN mode', () => {
    let enforcer;
    beforeEach(() => {
        enforcer = new PermissionEnforcer(PermissionMode.PLAN);
    });

    test('allows plan-tier tools', () => {
        const result = enforcer.check('system.stats');
        expect(result.allowed).toBe(true);
    });

    test('blocks non-plan tools in PLAN mode', () => {
        const result = enforcer.check('user.add');
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/plan/i);
    });

    test('blocks destructive tools in PLAN mode', () => {
        const result = enforcer.check('system.reboot');
        expect(result.allowed).toBe(false);
    });

    test('result includes activeMode and requiredMode', () => {
        const result = enforcer.check('system.stats');
        expect(result.activeMode).toBe(PermissionMode.PLAN);
        expect(result.requiredMode).toBe(PermissionMode.PLAN);
    });
});

describe('PermissionEnforcer — PROMPT mode', () => {
    let enforcer;
    beforeEach(() => {
        enforcer = new PermissionEnforcer(PermissionMode.PROMPT);
    });

    test('allows plan-tier tools without confirmation', () => {
        const result = enforcer.check('system.stats');
        expect(result.allowed).toBe(true);
        expect(result.requiresConfirmation).toBe(false);
    });

    test('allows mutation tools with confirmation flag', () => {
        const result = enforcer.check('user.add');
        expect(result.allowed).toBe(true);
        expect(result.requiresConfirmation).toBe(true);
    });

    test('allows destructive tools with confirmation flag', () => {
        const result = enforcer.check('system.reboot');
        expect(result.allowed).toBe(true);
        expect(result.requiresConfirmation).toBe(true);
    });
});

describe('PermissionEnforcer — AUTO mode', () => {
    let enforcer;
    beforeEach(() => {
        enforcer = new PermissionEnforcer(PermissionMode.AUTO);
    });

    test('allows all tool tiers without confirmation', () => {
        for (const tool of ['system.stats', 'user.add', 'system.reboot']) {
            const result = enforcer.check(tool);
            expect(result.allowed).toBe(true);
        }
    });
});

describe('PermissionEnforcer — deny list', () => {
    test('deny list blocks tool regardless of mode', () => {
        const ctx = new ToolPermissionContext({ denyNames: ['system.reboot'] });
        const enforcer = new PermissionEnforcer(PermissionMode.AUTO, ctx);
        const result = enforcer.check('system.reboot');
        expect(result.allowed).toBe(false);
        expect(result.reason).toMatch(/deny/i);
    });

    test('isAllowed returns boolean', () => {
        const enforcer = new PermissionEnforcer(PermissionMode.AUTO);
        expect(enforcer.isAllowed('ping')).toBe(true);
        const ctx = new ToolPermissionContext({ denyNames: ['ping'] });
        const blocked = new PermissionEnforcer(PermissionMode.AUTO, ctx);
        expect(blocked.isAllowed('ping')).toBe(false);
    });
});

// ── PermissionDenial ──────────────────────────────────────────────────────────

describe('PermissionDenial', () => {
    test('stores toolName and reason', () => {
        const d = new PermissionDenial('user.remove', 'PLAN mode active');
        expect(d.toolName).toBe('user.remove');
        expect(d.reason).toBe('PLAN mode active');
    });

    test('has an ISO timestamp', () => {
        const d = new PermissionDenial('ping', 'blocked');
        expect(new Date(d.timestamp).toISOString()).toBe(d.timestamp);
    });

    test('toJSON returns serialisable object', () => {
        const d = new PermissionDenial('user.kick', 'reason');
        const json = d.toJSON();
        expect(json).toMatchObject({ toolName: 'user.kick', reason: 'reason' });
        expect(typeof json.timestamp).toBe('string');
        expect(() => JSON.stringify(json)).not.toThrow();
    });
});
