'use strict';

const { BaseAdapter }   = require('../../adapters/base.adapter');
const { networkAgent }  = require('../../agents/network.agent');

// ── BaseAdapter ───────────────────────────────────────────────────────────────

describe('BaseAdapter', () => {
    class ConcreteAdapter extends BaseAdapter {
        async generate(prompt) { return { text: `echo: ${prompt}`, provider: 'concrete' }; }
    }

    test('stores name in constructor', () => {
        const a = new BaseAdapter('test-adapter');
        expect(a.name).toBe('test-adapter');
    });

    test('generate() throws on base class', async () => {
        const a = new BaseAdapter('base');
        await expect(a.generate('hi')).rejects.toThrow(/generate/);
    });

    test('generateStream() throws on base class', async () => {
        const a = new BaseAdapter('base');
        await expect(a.generateStream('hi')).rejects.toThrow(/generateStream/);
    });

    test('generateImage() throws on base class', async () => {
        const a = new BaseAdapter('base');
        await expect(a.generateImage('hi')).rejects.toThrow(/generateImage/);
    });

    test('generateAudio() throws on base class', async () => {
        const a = new BaseAdapter('base');
        await expect(a.generateAudio('hi')).rejects.toThrow(/generateAudio/);
    });

    test('generateFile() throws on base class', async () => {
        const a = new BaseAdapter('base');
        await expect(a.generateFile('hi')).rejects.toThrow(/generateFile/);
    });

    test('error message includes adapter name', async () => {
        const a = new BaseAdapter('my-adapter');
        await expect(a.generate('')).rejects.toThrow('my-adapter');
    });

    test('subclass can override generate()', async () => {
        const a = new ConcreteAdapter('concrete');
        const result = await a.generate('hello');
        expect(result.text).toBe('echo: hello');
        expect(result.provider).toBe('concrete');
    });

    test('subclass still throws for unimplemented methods', async () => {
        const a = new ConcreteAdapter('concrete');
        await expect(a.generateStream('hi')).rejects.toThrow();
    });
});

// ── networkAgent ──────────────────────────────────────────────────────────────

describe('networkAgent — structure', () => {
    test('has a name', () => {
        expect(typeof networkAgent.name).toBe('string');
        expect(networkAgent.name.length).toBeGreaterThan(0);
    });

    test('has a description', () => {
        expect(typeof networkAgent.description).toBe('string');
        expect(networkAgent.description.trim().length).toBeGreaterThan(0);
    });

    test('allowedTools is a non-empty array of strings', () => {
        expect(Array.isArray(networkAgent.allowedTools)).toBe(true);
        expect(networkAgent.allowedTools.length).toBeGreaterThan(0);
        networkAgent.allowedTools.forEach(t => expect(typeof t).toBe('string'));
    });

    test('allowedTools contains expected MikroTik operations', () => {
        expect(networkAgent.allowedTools).toContain('mikrotik.createUser');
        expect(networkAgent.allowedTools).toContain('mikrotik.getActiveUsers');
        expect(networkAgent.allowedTools).toContain('mikrotik.disconnectUser');
    });

    test('rules is a non-empty array of strings', () => {
        expect(Array.isArray(networkAgent.rules)).toBe(true);
        expect(networkAgent.rules.length).toBeGreaterThan(0);
        networkAgent.rules.forEach(r => expect(typeof r).toBe('string'));
    });
});

describe('networkAgent — preprocess', () => {
    test('merges input with priority and safeMode', () => {
        const result = networkAgent.preprocess(
            { userId: 'u1', action: 'kick' },
            { systemState: { mode: 'development' } }
        );
        expect(result.userId).toBe('u1');
        expect(result.priority).toBe('high');
        expect(result.safeMode).toBe(true);
    });

    test('safeMode is false in production', () => {
        const result = networkAgent.preprocess({}, { systemState: { mode: 'production' } });
        expect(result.safeMode).toBe(false);
    });

    test('safeMode is true when systemState is absent', () => {
        const result = networkAgent.preprocess({}, {});
        expect(result.safeMode).toBe(true);
    });

    test('does not mutate original input', () => {
        const input = { userId: 'u1' };
        networkAgent.preprocess(input, {});
        expect(input.priority).toBeUndefined();
    });
});

describe('networkAgent — postprocess', () => {
    test('passes through successful results unchanged', () => {
        const results = [{ success: true, data: 'ok' }];
        const processed = networkAgent.postprocess(results);
        expect(processed[0].alert).toBeUndefined();
        expect(processed[0].data).toBe('ok');
    });

    test('adds alert to failed results', () => {
        const results = [{ success: false, data: null }];
        const processed = networkAgent.postprocess(results);
        expect(processed[0].alert).toBeDefined();
        expect(typeof processed[0].alert).toBe('string');
    });

    test('handles mixed success/failure results', () => {
        const results = [
            { success: true },
            { success: false },
            { success: true }
        ];
        const processed = networkAgent.postprocess(results);
        expect(processed[0].alert).toBeUndefined();
        expect(processed[1].alert).toBeDefined();
        expect(processed[2].alert).toBeUndefined();
    });

    test('returns a new array (does not mutate)', () => {
        const results = [{ success: false }];
        const processed = networkAgent.postprocess(results);
        expect(processed).not.toBe(results);
    });

    test('handles empty results array', () => {
        expect(networkAgent.postprocess([])).toEqual([]);
    });
});
