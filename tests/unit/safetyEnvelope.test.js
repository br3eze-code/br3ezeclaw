'use strict';

jest.mock('../../src/utils/logger', () => ({
    Logger: class { info(){} warn(){} error(){} debug(){} }
}));

const { SafetyEnvelope } = require('../../src/core/safety-envelope');

// ── constructor ───────────────────────────────────────────────────────────────

describe('SafetyEnvelope — constructor', () => {
    test('initialises dangerous operations list', () => {
        const se = new SafetyEnvelope();
        expect(Array.isArray(se.dangerousOperations)).toBe(true);
        expect(se.dangerousOperations.length).toBeGreaterThan(0);
    });

    test('initialises blocked operations list', () => {
        const se = new SafetyEnvelope();
        expect(Array.isArray(se.blockedOperations)).toBe(true);
        expect(se.blockedOperations.length).toBeGreaterThan(0);
    });

    test('dangerous and blocked sets do not overlap', () => {
        const se = new SafetyEnvelope();
        const overlap = se.dangerousOperations.filter(op => se.blockedOperations.includes(op));
        expect(overlap).toHaveLength(0);
    });

    test('initialises empty policies map', () => {
        const se = new SafetyEnvelope();
        expect(se.policies).toBeInstanceOf(Map);
        expect(se.policies.size).toBe(0);
    });
});

// ── checkToolExecution ────────────────────────────────────────────────────────

describe('SafetyEnvelope — checkToolExecution', () => {
    let se;
    beforeEach(() => { se = new SafetyEnvelope(); });

    test('allows safe tools', () => {
        expect(se.checkToolExecution('user.add', {})).toBe(true);
        expect(se.checkToolExecution('system.stats', {})).toBe(true);
        expect(se.checkToolExecution('ping', {})).toBe(true);
    });

    test('blocks operations matching blocked list', () => {
        expect(se.checkToolExecution('system.shell.exec.rm', {})).toBe(false);
        expect(se.checkToolExecution('system.shell.exec.sudo', {})).toBe(false);
        expect(se.checkToolExecution('system.shell.exec.format', {})).toBe(false);
    });

    test('allows dangerous operations (warns but does not block)', () => {
        expect(se.checkToolExecution('mikrotik.system.reboot', {})).toBe(true);
        expect(se.checkToolExecution('mikrotik.system.reset', {})).toBe(true);
        expect(se.checkToolExecution('system.file.delete', {})).toBe(true);
    });

    test('blocked takes priority over dangerous', () => {
        // If a tool name contains a blocked substring it must be blocked
        expect(se.checkToolExecution('system.shell.exec.rm.critical', {})).toBe(false);
    });
});

// ── registerPolicy ────────────────────────────────────────────────────────────

describe('SafetyEnvelope — registerPolicy', () => {
    let se;
    beforeEach(() => { se = new SafetyEnvelope(); });

    test('registers and enforces custom validator', () => {
        se.registerPolicy('user.add', (params) => !!params.username);
        expect(se.checkToolExecution('user.add', { username: 'alice' })).toBe(true);
        expect(se.checkToolExecution('user.add', {})).toBe(false);
    });

    test('multiple policies can be registered on different tools', () => {
        se.registerPolicy('user.add',    (p) => !!p.username);
        se.registerPolicy('user.remove', (p) => !!p.id);
        expect(se.checkToolExecution('user.add',    { username: 'alice' })).toBe(true);
        expect(se.checkToolExecution('user.remove', { id: '42' })).toBe(true);
        expect(se.checkToolExecution('user.add',    {})).toBe(false);
        expect(se.checkToolExecution('user.remove', {})).toBe(false);
    });

    test('overwriting a policy replaces the previous one', () => {
        se.registerPolicy('ping', () => true);
        se.registerPolicy('ping', () => false);
        expect(se.checkToolExecution('ping', {})).toBe(false);
    });
});

// ── getLimits ─────────────────────────────────────────────────────────────────

describe('SafetyEnvelope — getLimits', () => {
    let se;
    beforeEach(() => { se = new SafetyEnvelope(); });

    test('returns expected shape', () => {
        const limits = se.getLimits();
        expect(limits).toHaveProperty('maxToolsPerRequest');
        expect(limits).toHaveProperty('maxIterations');
        expect(limits).toHaveProperty('dangerousOperations');
        expect(limits).toHaveProperty('blockedOperations');
    });

    test('maxToolsPerRequest is a positive integer', () => {
        const { maxToolsPerRequest } = se.getLimits();
        expect(Number.isInteger(maxToolsPerRequest)).toBe(true);
        expect(maxToolsPerRequest).toBeGreaterThan(0);
    });

    test('dangerousOperations matches instance list', () => {
        const limits = se.getLimits();
        expect(limits.dangerousOperations).toEqual(se.dangerousOperations);
    });

    test('blockedOperations matches instance list', () => {
        const limits = se.getLimits();
        expect(limits.blockedOperations).toEqual(se.blockedOperations);
    });

    test('is JSON-serialisable', () => {
        expect(() => JSON.stringify(se.getLimits())).not.toThrow();
    });
});

// ── checkRateLimit ────────────────────────────────────────────────────────────

describe('SafetyEnvelope — checkRateLimit', () => {
    test('allows requests within limit', async () => {
        const se = new SafetyEnvelope();
        const result = await se.checkRateLimit('sender-a');
        expect(result).toBe(true);
    });

    test('blocks sender after exhausting points', async () => {
        // Use a tiny limiter so we can exhaust it in tests
        const { RateLimiterMemory } = require('rate-limiter-flexible');
        const se = new SafetyEnvelope();
        // Replace limiter with 2-point limit
        se.rateLimiter = new RateLimiterMemory({ points: 2, duration: 60 });

        await se.checkRateLimit('heavy-sender');
        await se.checkRateLimit('heavy-sender');
        const blocked = await se.checkRateLimit('heavy-sender');
        expect(blocked).toBe(false);
    });

    test('different senders have independent limits', async () => {
        const { RateLimiterMemory } = require('rate-limiter-flexible');
        const se = new SafetyEnvelope();
        se.rateLimiter = new RateLimiterMemory({ points: 1, duration: 60 });

        await se.checkRateLimit('sender-x');
        const secondX = await se.checkRateLimit('sender-x');
        const firstY  = await se.checkRateLimit('sender-y');

        expect(secondX).toBe(false);
        expect(firstY).toBe(true);
    });
});
