'use strict';

// uuid is an optional peer dep in the test runner environment — mock it
jest.mock('uuid', () => {
    let counter = 0;
    return { v4: () => `mock-uuid-${++counter}` };
});

// Mock heavy dependencies so unit tests don't require live services
jest.mock('../../src/core/agentEngine',   () => ({ AgentEngine: class { static create() { return { sessionId: 'mock', submitMessage: jest.fn().mockResolvedValue({ stopReason: 'completed', output: 'ok' }), persistSession: jest.fn().mockReturnValue('/tmp/session'), renderSummary: jest.fn().mockReturnValue('summary'), enforcer: { check: jest.fn().mockReturnValue({ allowed: true }) } }; } static fromSession(id) { return this.create(); } } }));
jest.mock('../../src/core/mikrotik',      () => ({ getMikroTikClient: jest.fn() }));
jest.mock('../../src/core/logger',        () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const { AgentRuntime, RuntimeSession, TOOL_MANIFEST, getAgentRuntime } = require('../../src/core/agentRuntime');
const { PermissionMode } = require('../../src/core/permissions');
const { TaskStatus }     = require('../../src/core/taskRegistry');

// ── TOOL_MANIFEST ─────────────────────────────────────────────────────────────

describe('TOOL_MANIFEST', () => {
    test('is a non-empty array', () => {
        expect(Array.isArray(TOOL_MANIFEST)).toBe(true);
        expect(TOOL_MANIFEST.length).toBeGreaterThan(0);
    });

    test('every entry has a name and keywords array', () => {
        for (const entry of TOOL_MANIFEST) {
            expect(typeof entry.name).toBe('string');
            expect(Array.isArray(entry.keywords)).toBe(true);
            expect(entry.keywords.length).toBeGreaterThan(0);
        }
    });

    test('tool names are unique', () => {
        const names = TOOL_MANIFEST.map(t => t.name);
        expect(new Set(names).size).toBe(names.length);
    });

    test('expected tools are present', () => {
        const names = new Set(TOOL_MANIFEST.map(t => t.name));
        expect(names.has('system.stats')).toBe(true);
        expect(names.has('user.add')).toBe(true);
        expect(names.has('ping')).toBe(true);
        expect(names.has('firewall.block')).toBe(true);
    });
});

// ── AgentRuntime — routePrompt ────────────────────────────────────────────────

describe('AgentRuntime.routePrompt', () => {
    let runtime;
    beforeEach(() => { runtime = new AgentRuntime(); });

    test('returns array', () => {
        expect(Array.isArray(runtime.routePrompt('show me the stats'))).toBe(true);
    });

    test('returns empty array for unmatched prompt', () => {
        expect(runtime.routePrompt('xyzzy nonsense gibberish')).toEqual([]);
    });

    test('matches system.stats for stats keywords', () => {
        const tools = runtime.routePrompt('show cpu memory stats');
        expect(tools).toContain('system.stats');
    });

    test('matches ping for ping/latency keywords', () => {
        const tools = runtime.routePrompt('ping this host for latency');
        expect(tools).toContain('ping');
    });

    test('matches firewall.block for block/ban keywords', () => {
        const tools = runtime.routePrompt('block and ban this ip blacklist');
        expect(tools).toContain('firewall.block');
    });

    test('matches user.add for add/create/register keywords', () => {
        const tools = runtime.routePrompt('create a new user and register');
        expect(tools).toContain('user.add');
    });

    test('matches system.reboot for restart/reboot keywords', () => {
        const tools = runtime.routePrompt('reboot and restart the system');
        expect(tools).toContain('system.reboot');
    });

    test('respects limit parameter', () => {
        const tools = runtime.routePrompt('stats memory cpu logs active users connected sessions', 3);
        expect(tools.length).toBeLessThanOrEqual(3);
    });

    test('returns results sorted by descending match score', () => {
        // A prompt with many system.stats keywords should rank it first
        const tools = runtime.routePrompt('cpu memory resource health system stats');
        expect(tools[0]).toBe('system.stats');
    });

    test('is case-insensitive', () => {
        const tools = runtime.routePrompt('PING THE HOST');
        expect(tools).toContain('ping');
    });

    test('ignores punctuation in prompt', () => {
        const tools = runtime.routePrompt('ping! the host...');
        expect(tools).toContain('ping');
    });
});

// ── AgentRuntime — listTools / findTools ─────────────────────────────────────

describe('AgentRuntime.listTools', () => {
    let runtime;
    beforeEach(() => { runtime = new AgentRuntime(); });

    test('returns all tool names', () => {
        const tools = runtime.listTools();
        expect(tools).toHaveLength(TOOL_MANIFEST.length);
        expect(tools).toContain('ping');
        expect(tools).toContain('user.add');
    });
});

describe('AgentRuntime.findTools', () => {
    let runtime;
    beforeEach(() => { runtime = new AgentRuntime(); });

    test('finds by name substring', () => {
        const tools = runtime.findTools('firewall');
        expect(tools.length).toBeGreaterThan(0);
        expect(tools.every(t => t.includes('firewall'))).toBe(true);
    });

    test('finds by keyword', () => {
        const tools = runtime.findTools('ban');
        expect(tools).toContain('firewall.block');
    });

    test('returns empty array for no match', () => {
        expect(runtime.findTools('xyzzy123')).toEqual([]);
    });
});

// ── RuntimeSession ────────────────────────────────────────────────────────────

describe('RuntimeSession', () => {
    const mockEngine = {
        sessionId:     'sess-001',
        renderSummary: jest.fn().mockReturnValue('## State\nIdle'),
        enforcer:      { check: jest.fn().mockReturnValue({ allowed: true }) }
    };

    test('stores constructor fields', () => {
        const s = new RuntimeSession({
            prompt: 'test prompt', engine: mockEngine,
            matchedTools: ['ping'], permissionDenials: []
        });
        expect(s.prompt).toBe('test prompt');
        expect(s.matchedTools).toEqual(['ping']);
        expect(s.permissionDenials).toEqual([]);
        expect(s.taskId).toBeNull();
    });

    test('accepts optional taskId', () => {
        const s = new RuntimeSession({
            prompt: 'p', engine: mockEngine,
            matchedTools: [], permissionDenials: [], taskId: 'task-99'
        });
        expect(s.taskId).toBe('task-99');
    });

    test('has ISO createdAt timestamp', () => {
        const s = new RuntimeSession({
            prompt: 'p', engine: mockEngine,
            matchedTools: [], permissionDenials: []
        });
        expect(new Date(s.createdAt).toISOString()).toBe(s.createdAt);
    });

    test('asMarkdown returns string containing prompt and session id', () => {
        const s = new RuntimeSession({
            prompt: 'show stats', engine: mockEngine,
            matchedTools: ['system.stats'], permissionDenials: []
        });
        const md = s.asMarkdown();
        expect(typeof md).toBe('string');
        expect(md).toContain('show stats');
        expect(md).toContain('sess-001');
        expect(md).toContain('system.stats');
    });

    test('asMarkdown shows "none" when no tools matched', () => {
        const s = new RuntimeSession({
            prompt: 'gibberish', engine: mockEngine,
            matchedTools: [], permissionDenials: []
        });
        expect(s.asMarkdown()).toContain('none');
    });
});

// ── getAgentRuntime singleton ─────────────────────────────────────────────────

describe('getAgentRuntime', () => {
    test('returns the same instance on repeated calls', () => {
        const a = getAgentRuntime();
        const b = getAgentRuntime();
        expect(a).toBe(b);
    });

    test('instance is an AgentRuntime', () => {
        expect(getAgentRuntime()).toBeInstanceOf(AgentRuntime);
    });
});
