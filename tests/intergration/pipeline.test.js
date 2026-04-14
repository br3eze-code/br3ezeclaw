'use strict';

/**
 * Integration tests — components working together:
 *  - TaskRegistry + EventBus
 *  - SessionManager + MemoryStore
 *  - Permissions + AgentRuntime routing
 */

const os   = require('os');
const path = require('path');
const fs   = require('fs');

// ── shared mocks ──────────────────────────────────────────────────────────────

jest.mock('uuid', () => {
    let n = 0;
    return { v4: () => `intg-uuid-${++n}` };
});

jest.mock('../../src/utils/logger', () => ({
    Logger: class { info(){} warn(){} error(){} debug(){} }
}));

jest.mock('../../src/core/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

jest.mock('../../src/core/agentEngine', () => ({
    AgentEngine: class {
        static create() {
            return {
                sessionId:     'intg-sess-001',
                submitMessage: jest.fn().mockResolvedValue({ stopReason: 'completed', output: 'done' }),
                persistSession: jest.fn().mockReturnValue('/tmp/sess'),
                renderSummary:  jest.fn().mockReturnValue('idle'),
                enforcer: { check: jest.fn().mockReturnValue({ allowed: true }) }
            };
        }
        static fromSession() { return this.create(); }
    }
}));

jest.mock('../../src/core/mikrotik', () => ({ getMikroTikClient: jest.fn() }));

// ── TaskRegistry + EventBus integration ──────────────────────────────────────

describe('Integration — TaskRegistry + EventBus', () => {
    let TaskRegistry, TaskStatus, eventBus;

    beforeEach(() => {
        jest.resetModules();
        jest.mock('uuid', () => { let n=0; return { v4: () => `uuid-${++n}` }; });
        ({ TaskRegistry, TaskStatus } = require('../../src/core/taskRegistry'));
        eventBus = require('../../src/core/eventBus');
    });

    afterEach(() => {
        eventBus.removeAllListeners();
    });

    test('task creation events propagate through eventBus', () => {
        const registry = new TaskRegistry();
        const busHandler = jest.fn();
        eventBus.on('task:created', busHandler);

        // Wire registry events onto bus
        registry.on('task:created', t => eventBus.emit('task:created', t));

        const task = registry.create('scan network');
        expect(busHandler).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'scan network' }));
    });

    test('full task lifecycle emits events in order', () => {
        const registry = new TaskRegistry();
        const events   = [];

        registry.on('task:created',   () => events.push('created'));
        registry.on('task:running',   () => events.push('running'));
        registry.on('task:completed', () => events.push('completed'));

        const task = registry.create('full lifecycle');
        registry.setStatus(task.taskId, TaskStatus.RUNNING);
        registry.setStatus(task.taskId, TaskStatus.COMPLETED);

        expect(events).toEqual(['created', 'running', 'completed']);
    });

    test('summary correctly counts multiple tasks across statuses', () => {
        const registry = new TaskRegistry();
        const t1 = registry.create('a');
        const t2 = registry.create('b');
        const t3 = registry.create('c');
        const t4 = registry.create('d');

        registry.setStatus(t1.taskId, TaskStatus.RUNNING);
        registry.setStatus(t2.taskId, TaskStatus.COMPLETED);
        registry.setStatus(t3.taskId, TaskStatus.FAILED);

        const s = registry.summary();
        expect(s.total).toBe(4);
        expect(s.created).toBe(1);
        expect(s.running).toBe(1);
        expect(s.completed).toBe(1);
        expect(s.failed).toBe(1);
    });

    test('appendOutput accumulates messages correctly', () => {
        const registry = new TaskRegistry();
        const task     = registry.create('gather stats');

        registry.appendOutput(task.taskId, 'user',      'run stats');
        registry.appendOutput(task.taskId, 'assistant', 'cpu: 12%');
        registry.appendOutput(task.taskId, 'assistant', 'mem: 45%');

        const t = registry.get(task.taskId);
        expect(t.messages).toHaveLength(3);
        expect(t.output).toContain('cpu: 12%');
        expect(t.output).toContain('mem: 45%');
    });
});

// ── Permissions + AgentRuntime integration ────────────────────────────────────

describe('Integration — Permissions + AgentRuntime routing', () => {
    let AgentRuntime, PermissionMode, PermissionEnforcer;

    beforeAll(() => {
        jest.resetModules();
        jest.mock('uuid', () => { let n=0; return { v4: () => `uuid-${++n}` }; });
        jest.mock('../../src/core/agentEngine', () => ({
            AgentEngine: class {
                static create() { return { sessionId: 's', submitMessage: jest.fn().mockResolvedValue({ stopReason: 'completed', output: '' }), persistSession: jest.fn().mockReturnValue('/tmp'), renderSummary: jest.fn().mockReturnValue(''), enforcer: { check: jest.fn().mockReturnValue({ allowed: true }) } }; }
                static fromSession() { return this.create(); }
            }
        }));
        jest.mock('../../src/core/mikrotik', () => ({ getMikroTikClient: jest.fn() }));
        jest.mock('../../src/core/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
        ({ AgentRuntime } = require('../../src/core/agentRuntime'));
        ({ PermissionMode, PermissionEnforcer } = require('../../src/core/permissions'));
    });

    test('routePrompt finds multiple tools for complex prompt', () => {
        const rt    = new AgentRuntime();
        const tools = rt.routePrompt('show active users and system stats and memory health');
        expect(tools.length).toBeGreaterThanOrEqual(2);
        expect(tools).toContain('users.active');
        expect(tools).toContain('system.stats');
    });

    test('PLAN enforcer blocks user.add from routePrompt results', () => {
        const rt       = new AgentRuntime();
        const enforcer = new PermissionEnforcer(PermissionMode.PLAN);
        const tools    = rt.routePrompt('create a new user and register account');

        // user.add should be found by router but blocked by plan enforcer
        expect(tools).toContain('user.add');
        expect(enforcer.isAllowed('user.add')).toBe(false);
    });

    test('AUTO enforcer allows everything routePrompt returns', () => {
        const rt       = new AgentRuntime();
        const enforcer = new PermissionEnforcer(PermissionMode.AUTO);
        const tools    = rt.routePrompt('reboot restart disconnect kick ban block users stats logs');
        for (const tool of tools) {
            expect(enforcer.isAllowed(tool)).toBe(true);
        }
    });

    test('deny list overrides AUTO mode for specific tool', () => {
        const { ToolPermissionContext } = require('../../src/core/permissions');
        const ctx      = new ToolPermissionContext({ denyNames: ['system.reboot'] });
        const enforcer = new PermissionEnforcer(PermissionMode.AUTO, ctx);
        expect(enforcer.isAllowed('system.reboot')).toBe(false);
        expect(enforcer.isAllowed('system.stats')).toBe(true);
    });
});

// ── SessionManager + MemoryStore integration ──────────────────────────────────

describe('Integration — SessionManager filesystem round-trip', () => {
    const { SessionManager } = require('../../src/core/session-manager');
    let base, sm;

    beforeEach(async () => {
        base = path.join(os.tmpdir(), `agentos-intg-${Date.now()}`);
        sm   = new SessionManager({ basePath: base, mode: 'isolated' });
        await sm.initialize();
    });

    afterEach(() => {
        fs.rmSync(base, { recursive: true, force: true });
    });

    test('isolated DM sessions do not share history', async () => {
        const aliceId = sm.getSessionId({ agentId: 'bot', isDM: true, sender: 'alice' });
        const bobId   = sm.getSessionId({ agentId: 'bot', isDM: true, sender: 'bob'   });

        await sm.save(aliceId, [{ role: 'user', content: 'Alice msg' }]);
        await sm.save(bobId,   [{ role: 'user', content: 'Bob msg' }]);

        sm.cache.clear();

        const aliceHistory = await sm.load(aliceId);
        const bobHistory   = await sm.load(bobId);

        expect(aliceHistory[0].content).toBe('Alice msg');
        expect(bobHistory[0].content).toBe('Bob msg');
        expect(aliceHistory).not.toEqual(bobHistory);
    });

    test('compact removes old messages but keeps recent ones', async () => {
        const sessId  = 'compact-test';
        const history = Array.from({ length: 30 }, (_, i) => ({
            role:    i % 2 === 0 ? 'user' : 'assistant',
            content: `message ${i}`
        }));

        await sm.save(sessId, history);
        sm.cache.clear();
        await sm.compact(sessId, 10);
        sm.cache.clear();

        const loaded = await sm.load(sessId);
        expect(loaded.length).toBeLessThan(history.length);
        // Most recent message should still be present
        const contents = loaded.map(m => m.content);
        expect(contents).toContain('message 29');
    });

    test('clear removes session and subsequent load returns empty', async () => {
        const sessId = 'clear-test';
        await sm.save(sessId, [{ role: 'user', content: 'to be removed' }]);
        await sm.clear(sessId);
        sm.cache.clear();
        const history = await sm.load(sessId);
        expect(history).toEqual([]);
    });

    test('getStats reflects saved sessions', async () => {
        const s1 = sm.getSessionId({ agentId: 'bot', isDM: true, sender: 'u1' });
        const s2 = sm.getSessionId({ agentId: 'bot', isDM: true, sender: 'u2' });
        await sm.save(s1, [{ role: 'user', content: 'hi' }]);
        await sm.save(s2, [{ role: 'user', content: 'hey' }]);

        const stats = await sm.getStats();
        expect(stats.totalSessions).toBeGreaterThanOrEqual(2);
    });
});

// ── Voucher + EventBus integration ────────────────────────────────────────────

describe('Integration — VoucherAgent + EventBus', () => {
    beforeEach(() => { jest.resetModules(); });

    test('generate → redeem emits events in correct order', () => {
        const eventBus = require('../../src/core/eventBus');
        const voucher  = require('../../src/core/voucher');
        const events   = [];

        eventBus.on('voucher.created',  e => events.push({ type: 'created',  code: e.code }));
        eventBus.on('voucher.redeemed', e => events.push({ type: 'redeemed', code: e.code }));

        const code = voucher.generate('1day');
        voucher.redeem(code, 'user-001');

        expect(events[0].type).toBe('created');
        expect(events[1].type).toBe('redeemed');
        expect(events[0].code).toBe(events[1].code);

        eventBus.removeAllListeners();
    });

    test('multiple vouchers emit independent events', () => {
        const eventBus = require('../../src/core/eventBus');
        const voucher  = require('../../src/core/voucher');
        const codes    = [];

        eventBus.on('voucher.created', e => codes.push(e.code));

        voucher.generate('1hour');
        voucher.generate('1day');
        voucher.generate('1week');

        expect(codes).toHaveLength(3);
        expect(new Set(codes).size).toBe(3); // all unique

        eventBus.removeAllListeners();
    });
});
