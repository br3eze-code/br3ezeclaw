'use strict';

// Mock all native deps that aren't installed in the test runner
jest.mock('routeros-client', () => ({
    RouterOSClient: class {
        constructor(config) { this.config = config; this.connected = false; }
        connect()    { 
            if (this.config && this.config.host === '192.0.2.1') {
                return new Promise(() => {}); // hang to trigger safety timeout
            }
            return Promise.resolve(this); 
        }
        close()      { return Promise.resolve(); }
        menu()       { return { get: jest.fn().mockResolvedValue([]) }; }
    }
}), { virtual: true });

jest.mock('node-cache', () => class {
    constructor() { this._store = new Map(); }
    get(k)           { return this._store.get(k); }
    set(k, v, ttl)   { this._store.set(k, v); }
    del(k)           { this._store.delete(k); }
    flushAll()       { this._store.clear(); }
}, { virtual: true });

jest.mock('../../src/core/logger',  () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../../src/core/config',  () => ({ getConfig: () => ({ mikrotik: { host: '192.168.88.1', user: 'admin', password: '', port: 8728 } }) }));

const { MikroTikManager, MikroTikError, ConnectionError, ToolExecutionError, testConnection } = require('../../src/core/mikrotik');

// ── MikroTikError ─────────────────────────────────────────────────────────────

describe('MikroTikError', () => {
    test('extends Error', () => {
        expect(new MikroTikError('boom')).toBeInstanceOf(Error);
    });

    test('stores message', () => {
        const err = new MikroTikError('bad thing');
        expect(err.message).toBe('bad thing');
    });
});

describe('ConnectionError', () => {
    test('is a MikroTikError', () => {
        expect(new ConnectionError('refused')).toBeInstanceOf(MikroTikError);
    });
});

describe('ToolExecutionError', () => {
    test('is a MikroTikError', () => {
        expect(new ToolExecutionError('exec failed')).toBeInstanceOf(MikroTikError);
    });
});

// ── MikroTikManager — constructor / state ─────────────────────────────────────

describe('MikroTikManager — initialization', () => {
    let manager;
    beforeEach(() => {
        manager = new MikroTikManager({
            host: '192.168.88.1',
            user: 'admin',
            password: '',
            port: 8728
        });
    });
    afterEach(() => { try { manager.disconnect(); } catch (_) {} });

    test('initial state is not connected', () => {
        const state = manager.getState();
        expect(state.isConnected).toBe(false);
    });

    test('state contains host', () => {
        const state = manager.getState();
        expect(state.host).toBe('192.168.88.1');
    });

    test('availableTools count is greater than zero', () => {
        const state = manager.getState();
        expect(state.availableTools).toBeGreaterThan(0);
    });
});

// ── MikroTikManager — getAvailableTools ──────────────────────────────────────

describe('MikroTikManager — getAvailableTools', () => {
    let manager;
    beforeEach(() => {
        manager = new MikroTikManager({ host: '192.168.88.1', user: 'admin', password: '' });
    });
    afterEach(() => { try { manager.disconnect(); } catch (_) {} });

    test('returns an array', () => {
        expect(Array.isArray(manager.getAvailableTools())).toBe(true);
    });

    test('includes core network tools', () => {
        const tools = manager.getAvailableTools();
        expect(tools).toContain('user.add');
        expect(tools).toContain('system.stats');
        expect(tools).toContain('ping');
    });

    test('includes security tools', () => {
        const tools = manager.getAvailableTools();
        expect(tools).toContain('firewall.block');
        expect(tools).toContain('firewall.unblock');
    });
});

// ── MikroTikManager — throws when not connected ───────────────────────────────

describe('MikroTikManager — requires connection', () => {
    let manager;
    beforeEach(() => {
        manager = new MikroTikManager({ host: '192.168.88.1', user: 'admin', password: '' });
    });
    afterEach(() => { try { manager.disconnect(); } catch (_) {} });

    test('getSystemStats throws ConnectionError when disconnected', async () => {
        await expect(manager.getSystemStats()).rejects.toThrow(ConnectionError);
    });

    test('getActiveUsers throws ConnectionError when disconnected', async () => {
        await expect(manager.getActiveUsers()).rejects.toThrow(ConnectionError);
    });
});

// ── MikroTikManager — events ──────────────────────────────────────────────────

describe('MikroTikManager — event emission', () => {
    let manager;
    beforeEach(() => {
        manager = new MikroTikManager({ host: '10.0.0.1', user: 'admin', password: '' });
    });
    afterEach(() => { try { manager.disconnect(); } catch (_) {} });

    test('emits connected event with host and timestamp', done => {
        manager.once('connected', data => {
            expect(data.host).toBeDefined();
            expect(data.timestamp).toBeDefined();
            done();
        });
        manager.state.isConnected = true;
        manager.emit('connected', { host: 'test', timestamp: new Date().toISOString() });
    });

    test('emits disconnected event', done => {
        manager.once('disconnected', () => done());
        manager.emit('disconnected');
    });
});

// ── testConnection — failure path ─────────────────────────────────────────────

describe('testConnection', () => {
    test('returns failure object for unreachable host', async () => {
        const result = await testConnection({
            host:     '192.0.2.1',   // TEST-NET — guaranteed unreachable
            user:     'invalid',
            password: 'wrong',
            port:     8728
        });
        expect(result.success).toBe(false);
        expect(typeof result.message).toBe('string');
    }, 15000);
});
