'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');

// Mock logger so fileIO doesn't need winston configured
jest.mock('../../src/core/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

const {
    writeFile, readFile, appendJson,
    readRaw, writeRaw, appendRaw,
    deleteFile, fileExists, listDirectory, getFileStats,
    setCache, getCache, clearCache
} = require('../../tools/system/fileIO');

// ── helpers ───────────────────────────────────────────────────────────────────

function tmpPath(name) {
    return path.join(os.tmpdir(), `agentos-test-${Date.now()}-${name}`);
}

// ── writeFile / readFile ──────────────────────────────────────────────────────

describe('fileIO — writeFile / readFile', () => {
    let filePath;
    afterEach(() => { try { fs.unlinkSync(filePath); } catch (_) {} });

    test('writes and reads JSON object', () => {
        filePath = tmpPath('obj.json');
        const data = { name: 'AgentOS', version: '2026.4' };
        expect(writeFile(filePath, data)).toBe(true);
        expect(readFile(filePath)).toEqual(data);
    });

    test('writes and reads JSON array', () => {
        filePath = tmpPath('arr.json');
        const data = [1, 2, 3];
        writeFile(filePath, data);
        expect(readFile(filePath)).toEqual(data);
    });

    test('readFile returns fallback when file does not exist', () => {
        filePath = tmpPath('ghost.json');
        expect(readFile(filePath, 'default')).toBe('default');
        expect(readFile(filePath)).toBeNull();
    });

    test('writeFile returns true on success', () => {
        filePath = tmpPath('flag.json');
        expect(writeFile(filePath, {})).toBe(true);
    });

    test('writeFile creates parent directories automatically', () => {
        const nested = path.join(os.tmpdir(), `agentos-nested-${Date.now()}`, 'deep', 'file.json');
        filePath = nested;
        expect(writeFile(nested, { ok: true })).toBe(true);
        expect(readFile(nested)).toEqual({ ok: true });
        // cleanup
        try { fs.rmSync(path.dirname(path.dirname(nested)), { recursive: true }); } catch (_) {}
    });

    test('readFile returns fallback on JSON parse error', () => {
        filePath = tmpPath('bad.json');
        fs.writeFileSync(filePath, 'NOT JSON {{{{');
        expect(readFile(filePath, 'fallback')).toBe('fallback');
    });
});

// ── appendJson ────────────────────────────────────────────────────────────────

describe('fileIO — appendJson', () => {
    let filePath;
    afterEach(() => { try { fs.unlinkSync(filePath); } catch (_) {} });

    test('creates file and appends first record', () => {
        filePath = tmpPath('append.json');
        appendJson(filePath, { id: 1 });
        expect(readFile(filePath)).toEqual([{ id: 1 }]);
    });

    test('appends multiple records in order', () => {
        filePath = tmpPath('multi.json');
        appendJson(filePath, { id: 1 });
        appendJson(filePath, { id: 2 });
        appendJson(filePath, { id: 3 });
        expect(readFile(filePath)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    });

    test('returns true on success', () => {
        filePath = tmpPath('ret.json');
        expect(appendJson(filePath, { x: 1 })).toBe(true);
    });
});

// ── readRaw / writeRaw ────────────────────────────────────────────────────────

describe('fileIO — readRaw / writeRaw', () => {
    let filePath;
    afterEach(() => { try { fs.unlinkSync(filePath); } catch (_) {} });

    test('writes and reads raw string', () => {
        filePath = tmpPath('raw.txt');
        writeRaw(filePath, 'Hello, AgentOS!');
        expect(readRaw(filePath)).toBe('Hello, AgentOS!');
    });
});

// ── deleteFile / fileExists ───────────────────────────────────────────────────

describe('fileIO — deleteFile / fileExists', () => {
    let filePath;

    test('fileExists returns false for missing file', () => {
        expect(fileExists(tmpPath('nope.json'))).toBe(false);
    });

    test('fileExists returns true after writing', () => {
        filePath = tmpPath('exists.json');
        writeFile(filePath, {});
        expect(fileExists(filePath)).toBe(true);
        fs.unlinkSync(filePath);
    });

    test('deleteFile removes the file', () => {
        filePath = tmpPath('del.json');
        writeFile(filePath, {});
        deleteFile(filePath);
        expect(fileExists(filePath)).toBe(false);
    });
});

// ── listDirectory ─────────────────────────────────────────────────────────────

describe('fileIO — listDirectory', () => {
    test('lists files in an existing directory', () => {
        const entries = listDirectory(os.tmpdir());
        expect(Array.isArray(entries)).toBe(true);
    });
});

// ── getFileStats ──────────────────────────────────────────────────────────────

describe('fileIO — getFileStats', () => {
    let filePath;
    afterEach(() => { try { fs.unlinkSync(filePath); } catch (_) {} });

    test('returns stats object with size', () => {
        filePath = tmpPath('stats.json');
        writeFile(filePath, { big: 'data' });
        const stats = getFileStats(filePath);
        expect(stats.size).toBeGreaterThan(0);
    });
});

// ── In-memory cache ───────────────────────────────────────────────────────────

describe('fileIO — cache', () => {
    beforeEach(() => clearCache());

    test('setCache and getCache round-trip', () => {
        setCache('router-stats', { cpu: 12 });
        expect(getCache('router-stats')).toEqual({ cpu: 12 });
    });

    test('getCache returns null for missing key', () => {
        expect(getCache('missing-key')).toBeNull();
    });

    test('getCache returns null after TTL expires', async () => {
        setCache('short', 'value');
        await new Promise(r => setTimeout(r, 20));
        expect(getCache('short', 10)).toBeNull(); // 10ms TTL, already expired
    });

    test('getCache returns value within TTL', async () => {
        setCache('fresh', 'data');
        await new Promise(r => setTimeout(r, 5));
        expect(getCache('fresh', 60000)).toBe('data');
    });

    test('clearCache(key) removes specific key', () => {
        setCache('a', 1);
        setCache('b', 2);
        clearCache('a');
        expect(getCache('a')).toBeNull();
        expect(getCache('b')).toBe(2);
    });

    test('clearCache() with no arg removes all keys', () => {
        setCache('x', 1);
        setCache('y', 2);
        clearCache();
        expect(getCache('x')).toBeNull();
        expect(getCache('y')).toBeNull();
    });

    test('can cache any JSON-compatible value types', () => {
        setCache('arr',  [1, 2, 3]);
        setCache('obj',  { a: 1 });
        setCache('bool', false);
        setCache('num',  42);
        expect(getCache('arr')).toEqual([1, 2, 3]);
        expect(getCache('obj')).toEqual({ a: 1 });
        expect(getCache('bool')).toBe(false);
        expect(getCache('num')).toBe(42);
    });
});
