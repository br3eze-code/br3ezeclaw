'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

// Stub Logger so we don't need winston in test runner
jest.mock('../utils/logger', () => ({
    Logger: class {
        info()  {}
        warn()  {}
        error() {}
        debug() {}
    }
}), { virtual: true });

jest.mock('../../src/utils/logger', () => ({
    Logger: class {
        info()  {}
        warn()  {}
        error() {}
        debug() {}
    }
}));

const { SessionManager } = require('../../src/core/session-manager');

function tmpBase() {
    const dir = path.join(os.tmpdir(), `agentos-sm-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    return dir;
}

// ── constructor / defaults ────────────────────────────────────────────────────

describe('SessionManager — constructor', () => {
    test('uses provided basePath', () => {
        const sm = new SessionManager({ basePath: '/tmp/custom' });
        expect(sm.basePath).toBe('/tmp/custom');
    });

    test('defaults to isolated mode', () => {
        const sm = new SessionManager({ basePath: '/tmp/x' });
        expect(sm.mode).toBe('isolated');
    });

    test('accepts shared mode', () => {
        const sm = new SessionManager({ basePath: '/tmp/x', mode: 'shared' });
        expect(sm.mode).toBe('shared');
    });

    test('initialises with empty cache', () => {
        const sm = new SessionManager({ basePath: '/tmp/x' });
        expect(sm.cache.size).toBe(0);
    });
});

// ── initialize ────────────────────────────────────────────────────────────────

describe('SessionManager — initialize', () => {
    test('creates base directory', async () => {
        const base = tmpBase();
        const sm = new SessionManager({ basePath: base });
        await sm.initialize();
        expect(fs.existsSync(base)).toBe(true);
        fs.rmSync(base, { recursive: true });
    });

    test('does not throw if directory already exists', async () => {
        const base = tmpBase();
        fs.mkdirSync(base, { recursive: true });
        const sm = new SessionManager({ basePath: base });
        await expect(sm.initialize()).resolves.not.toThrow();
        fs.rmSync(base, { recursive: true });
    });
});

// ── getSessionId ──────────────────────────────────────────────────────────────

describe('SessionManager — getSessionId', () => {
    let sm;
    beforeEach(() => { sm = new SessionManager({ basePath: '/tmp/test', mode: 'isolated' }); });

    test('isolated + DM → uses sender in path', () => {
        const id = sm.getSessionId({ agentId: 'bot', isDM: true, sender: 'user123' });
        expect(id).toContain('user123');
    });

    test('isolated + DM → sanitises sender with special chars', () => {
        const id = sm.getSessionId({ agentId: 'bot', isDM: true, sender: 'user@123!#' });
        expect(id).not.toMatch(/[@!#]/);
    });

    test('isolated + not DM → shared path (agentId/main)', () => {
        const id = sm.getSessionId({ agentId: 'bot', isDM: false, sender: 'user123' });
        expect(id).not.toContain('user123');
        expect(id).toContain('main');
    });

    test('shared mode → always returns shared path', () => {
        const shared = new SessionManager({ basePath: '/tmp/test', mode: 'shared' });
        const id1 = shared.getSessionId({ agentId: 'bot', isDM: true, sender: 'user1' });
        const id2 = shared.getSessionId({ agentId: 'bot', isDM: true, sender: 'user2' });
        expect(id1).toBe(id2);
    });

    test('defaults agentId to "default"', () => {
        const id = sm.getSessionId({ isDM: false, sender: 'x' });
        expect(id).toContain('default');
    });

    test('different senders get different session IDs in isolated DM mode', () => {
        const id1 = sm.getSessionId({ agentId: 'bot', isDM: true, sender: 'alice' });
        const id2 = sm.getSessionId({ agentId: 'bot', isDM: true, sender: 'bob' });
        expect(id1).not.toBe(id2);
    });
});

// ── load — missing file → empty array ─────────────────────────────────────────

describe('SessionManager — load', () => {
    let sm, base;
    beforeEach(async () => {
        base = tmpBase();
        sm   = new SessionManager({ basePath: base });
        await sm.initialize();
    });
    afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

    test('returns empty array for non-existent session', async () => {
        const history = await sm.load('new-session');
        expect(history).toEqual([]);
    });

    test('returns from cache if already loaded', async () => {
        sm.cache.set('cached-sess', [{ role: 'user', content: 'hi' }]);
        const result = await sm.load('cached-sess');
        expect(result).toEqual([{ role: 'user', content: 'hi' }]);
    });
});

// ── save / load round-trip ────────────────────────────────────────────────────

describe('SessionManager — save / load', () => {
    let sm, base;
    beforeEach(async () => {
        base = tmpBase();
        sm   = new SessionManager({ basePath: base });
        await sm.initialize();
    });
    afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

    test('saves and reloads session history', async () => {
        const history = [
            { role: 'user',      content: 'hello' },
            { role: 'assistant', content: 'hi there' }
        ];
        await sm.save('sess-01', history);
        sm.cache.clear(); // force disk read
        const loaded = await sm.load('sess-01');
        expect(loaded).toEqual(history);
    });

    test('overwrites existing session on save', async () => {
        await sm.save('sess-02', [{ role: 'user', content: 'v1' }]);
        await sm.save('sess-02', [{ role: 'user', content: 'v2' }]);
        sm.cache.clear();
        const loaded = await sm.load('sess-02');
        expect(loaded).toHaveLength(1);
        expect(loaded[0].content).toBe('v2');
    });
});

// ── append ────────────────────────────────────────────────────────────────────

describe('SessionManager — append', () => {
    let sm, base;
    beforeEach(async () => {
        base = tmpBase();
        sm   = new SessionManager({ basePath: base });
        await sm.initialize();
    });
    afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

    test('appends entries to session', async () => {
        await sm.append('sess-app', { role: 'user', content: 'msg1' });
        await sm.append('sess-app', { role: 'assistant', content: 'reply1' });
        const history = sm.cache.get('sess-app');
        expect(history).toHaveLength(2);
    });
});

// ── clear ─────────────────────────────────────────────────────────────────────

describe('SessionManager — clear', () => {
    let sm, base;
    beforeEach(async () => {
        base = tmpBase();
        sm   = new SessionManager({ basePath: base });
        await sm.initialize();
    });
    afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

    test('removes session file and cache entry', async () => {
        await sm.save('to-clear', [{ role: 'user', content: 'bye' }]);
        await sm.clear('to-clear');
        expect(sm.cache.has('to-clear')).toBe(false);
        sm.cache.clear();
        const reloaded = await sm.load('to-clear');
        expect(reloaded).toEqual([]);
    });

    test('does not throw when clearing non-existent session', async () => {
        await expect(sm.clear('ghost-session')).resolves.not.toThrow();
    });
});

// ── summarizeHistory ──────────────────────────────────────────────────────────

describe('SessionManager — summarizeHistory', () => {
    let sm;
    beforeEach(() => { sm = new SessionManager({ basePath: '/tmp/x' }); });

    test('returns "No prior context" for empty history', () => {
        expect(sm.summarizeHistory([])).toBe('No prior context');
    });

    test('includes message count', () => {
        const history = [
            { role: 'user', content: 'message one' },
            { role: 'user', content: 'message two' }
        ];
        const summary = sm.summarizeHistory(history);
        expect(summary).toContain('2');
    });

    test('includes tool call count', () => {
        const history = [
            { role: 'user',  content: 'do something' },
            { role: 'tool',  content: 'result1' },
            { role: 'tool',  content: 'result2' }
        ];
        const summary = sm.summarizeHistory(history);
        expect(summary).toContain('2');
    });

    test('truncates long messages in summary', () => {
        const long = 'a'.repeat(200);
        const history = [{ role: 'user', content: long }];
        const summary = sm.summarizeHistory(history);
        expect(summary.length).toBeLessThan(400);
    });
});

// ── getStats ──────────────────────────────────────────────────────────────────

describe('SessionManager — getStats', () => {
    let sm, base;
    beforeEach(async () => {
        base = tmpBase();
        sm   = new SessionManager({ basePath: base });
        await sm.initialize();
    });
    afterEach(() => { fs.rmSync(base, { recursive: true, force: true }); });

    test('returns stats object with expected keys', async () => {
        const stats = await sm.getStats();
        expect(stats).toHaveProperty('totalSessions');
        expect(stats).toHaveProperty('cachedSessions');
        expect(stats).toHaveProperty('mode');
    });

    test('cachedSessions reflects cache size', async () => {
        sm.cache.set('x', []);
        sm.cache.set('y', []);
        const stats = await sm.getStats();
        expect(stats.cachedSessions).toBe(2);
    });

    test('mode is reflected correctly', async () => {
        const stats = await sm.getStats();
        expect(stats.mode).toBe('isolated');
    });
});

// ── LRU cache eviction ────────────────────────────────────────────────────────

describe('SessionManager — cache eviction', () => {
    test('evicts oldest entry when cache exceeds maxCacheSize', () => {
        const sm = new SessionManager({ basePath: '/tmp/x' });
        sm.maxCacheSize = 3;

        sm.addToCache('a', []);
        sm.addToCache('b', []);
        sm.addToCache('c', []);
        sm.addToCache('d', []); // should evict 'a'

        expect(sm.cache.has('a')).toBe(false);
        expect(sm.cache.has('d')).toBe(true);
        expect(sm.cache.size).toBe(3);
    });
});
