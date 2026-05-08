'use strict';

// uuid is an optional peer dep in the test runner environment — mock it
jest.mock('uuid', () => {
    let counter = 0;
    return { v4: () => `mock-uuid-${++counter}` };
});

const { TaskRegistry, TaskStatus, getTaskRegistry } = require('../../src/core/taskRegistry');

// ── TaskStatus ────────────────────────────────────────────────────────────────

describe('TaskStatus', () => {
    test('has all expected statuses', () => {
        expect(TaskStatus.CREATED).toBe('created');
        expect(TaskStatus.RUNNING).toBe('running');
        expect(TaskStatus.COMPLETED).toBe('completed');
        expect(TaskStatus.FAILED).toBe('failed');
        expect(TaskStatus.STOPPED).toBe('stopped');
    });

    test('is frozen', () => {
        expect(() => { TaskStatus.NEW = 'new'; }).toThrow();
    });
});

// ── TaskRegistry — CRUD ───────────────────────────────────────────────────────

describe('TaskRegistry — create', () => {
    let registry;
    beforeEach(() => { registry = new TaskRegistry(); });

    test('returns a task with required fields', () => {
        const task = registry.create('check system stats');
        expect(task.taskId).toBeDefined();
        expect(task.prompt).toBe('check system stats');
        expect(task.status).toBe(TaskStatus.CREATED);
        expect(task.messages).toEqual([]);
        expect(task.output).toBe('');
        expect(task.createdAt).toBeGreaterThan(0);
        expect(task.updatedAt).toBeGreaterThan(0);
    });

    test('assigns description when provided', () => {
        const task = registry.create('do something', { description: 'Network audit' });
        expect(task.description).toBe('Network audit');
    });

    test('assigns teamId when provided', () => {
        const task = registry.create('task', { teamId: 'team-alpha' });
        expect(task.teamId).toBe('team-alpha');
    });

    test('generates unique taskIds', () => {
        const ids = new Set(Array.from({ length: 50 }, () => registry.create('t').taskId));
        expect(ids.size).toBe(50);
    });

    test('increments counter', () => {
        registry.create('a');
        registry.create('b');
        registry.create('c');
        expect(registry.counter).toBe(3);
    });

    test('emits task:created event', () => {
        const handler = jest.fn();
        registry.on('task:created', handler);
        const task = registry.create('listen');
        expect(handler).toHaveBeenCalledWith(task);
    });
});

describe('TaskRegistry — get', () => {
    let registry;
    beforeEach(() => { registry = new TaskRegistry(); });

    test('returns task by id', () => {
        const task = registry.create('find me');
        expect(registry.get(task.taskId)).toBe(task);
    });

    test('returns null for unknown id', () => {
        expect(registry.get('does-not-exist')).toBeNull();
    });
});

describe('TaskRegistry — list', () => {
    let registry;
    beforeEach(() => { registry = new TaskRegistry(); });

    test('returns all tasks when no filter', () => {
        registry.create('a');
        registry.create('b');
        registry.create('c');
        expect(registry.list()).toHaveLength(3);
    });

    test('returns empty array when registry is empty', () => {
        expect(registry.list()).toEqual([]);
    });

    test('filters by status', () => {
        const t1 = registry.create('a');
        const t2 = registry.create('b');
        registry.setStatus(t1.taskId, TaskStatus.RUNNING);
        const running = registry.list(TaskStatus.RUNNING);
        expect(running).toHaveLength(1);
        expect(running[0].taskId).toBe(t1.taskId);
    });
});

describe('TaskRegistry — update', () => {
    let registry;
    beforeEach(() => { registry = new TaskRegistry(); });

    test('merges patch into task', () => {
        const task = registry.create('original');
        registry.update(task.taskId, { prompt: 'updated' });
        expect(registry.get(task.taskId).prompt).toBe('updated');
    });

    test('updates updatedAt timestamp', async () => {
        const task = registry.create('ts');
        const before = task.updatedAt;
        await new Promise(r => setTimeout(r, 5));
        registry.update(task.taskId, { prompt: 'new' });
        expect(registry.get(task.taskId).updatedAt).toBeGreaterThan(before);
    });

    test('returns null for unknown id', () => {
        expect(registry.update('ghost', {})).toBeNull();
    });

    test('emits task:updated event', () => {
        const handler = jest.fn();
        registry.on('task:updated', handler);
        const task = registry.create('watch');
        registry.update(task.taskId, { prompt: 'changed' });
        expect(handler).toHaveBeenCalled();
    });
});

describe('TaskRegistry — appendOutput', () => {
    let registry;
    beforeEach(() => { registry = new TaskRegistry(); });

    test('appends message and updates output string', () => {
        const task = registry.create('output test');
        registry.appendOutput(task.taskId, 'assistant', 'Hello');
        registry.appendOutput(task.taskId, 'assistant', 'World');
        const t = registry.get(task.taskId);
        expect(t.messages).toHaveLength(2);
        expect(t.output).toContain('Hello');
        expect(t.output).toContain('World');
    });

    test('message has role, content, timestamp', () => {
        const task = registry.create('msg');
        registry.appendOutput(task.taskId, 'user', 'ping');
        const msg = registry.get(task.taskId).messages[0];
        expect(msg.role).toBe('user');
        expect(msg.content).toBe('ping');
        expect(msg.timestamp).toBeGreaterThan(0);
    });

    test('silently ignores unknown taskId', () => {
        expect(() => registry.appendOutput('ghost', 'user', 'x')).not.toThrow();
    });
});

describe('TaskRegistry — setStatus', () => {
    let registry;
    beforeEach(() => { registry = new TaskRegistry(); });

    test('updates task status', () => {
        const task = registry.create('run me');
        registry.setStatus(task.taskId, TaskStatus.RUNNING);
        expect(registry.get(task.taskId).status).toBe(TaskStatus.RUNNING);
    });

    test('emits status-specific event', () => {
        const handler = jest.fn();
        registry.on('task:completed', handler);
        const task = registry.create('emit test');
        registry.setStatus(task.taskId, TaskStatus.COMPLETED);
        expect(handler).toHaveBeenCalledWith(expect.objectContaining({ taskId: task.taskId }));
    });

    test('appends reason message when provided', () => {
        const task = registry.create('fail me');
        registry.setStatus(task.taskId, TaskStatus.FAILED, 'timeout');
        const msgs = registry.get(task.taskId).messages;
        expect(msgs.some(m => m.content.includes('timeout'))).toBe(true);
    });

    test('silently ignores unknown taskId', () => {
        expect(() => registry.setStatus('ghost', TaskStatus.FAILED)).not.toThrow();
    });
});

describe('TaskRegistry — stop', () => {
    let registry;
    beforeEach(() => { registry = new TaskRegistry(); });

    test('sets task to STOPPED status', () => {
        const task = registry.create('stop me');
        registry.stop(task.taskId);
        expect(registry.get(task.taskId).status).toBe(TaskStatus.STOPPED);
    });
});

describe('TaskRegistry — assignTeam', () => {
    let registry;
    beforeEach(() => { registry = new TaskRegistry(); });

    test('assigns teamId to task', () => {
        const task = registry.create('team task');
        registry.assignTeam(task.taskId, 'team-bravo');
        expect(registry.get(task.taskId).teamId).toBe('team-bravo');
    });
});

describe('TaskRegistry — summary', () => {
    let registry;
    beforeEach(() => { registry = new TaskRegistry(); });

    test('returns counts for all statuses', () => {
        const t1 = registry.create('a');
        const t2 = registry.create('b');
        const t3 = registry.create('c');
        registry.setStatus(t1.taskId, TaskStatus.RUNNING);
        registry.setStatus(t2.taskId, TaskStatus.COMPLETED);

        const s = registry.summary();
        expect(s.total).toBe(3);
        expect(s.created).toBe(1);
        expect(s.running).toBe(1);
        expect(s.completed).toBe(1);
        expect(s.failed).toBe(0);
        expect(s.stopped).toBe(0);
    });

    test('returns zero counts for empty registry', () => {
        const s = registry.summary();
        expect(s.total).toBe(0);
        expect(s.created).toBe(0);
    });
});

// ── getTaskRegistry singleton ─────────────────────────────────────────────────

describe('getTaskRegistry', () => {
    test('returns the same instance on multiple calls', () => {
        const a = getTaskRegistry();
        const b = getTaskRegistry();
        expect(a).toBe(b);
    });

    test('returned instance is a TaskRegistry', () => {
        expect(getTaskRegistry()).toBeInstanceOf(TaskRegistry);
    });
});
