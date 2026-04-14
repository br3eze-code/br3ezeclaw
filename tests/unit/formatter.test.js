'use strict';

const { formatBytes, formatUptime } = require('../../src/utils/formatters');

// ── formatBytes ───────────────────────────────────────────────────────────────

describe('formatBytes', () => {
    test('returns "0 B" for zero', () => {
        expect(formatBytes(0)).toBe('0 B');
    });

    test('formats bytes correctly', () => {
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(1023)).toBe('1023 B');
    });

    test('formats kilobytes', () => {
        expect(formatBytes(1024)).toBe('1 KB');
        expect(formatBytes(2048)).toBe('2 KB');
        expect(formatBytes(1536)).toBe('1.5 KB');
    });

    test('formats megabytes', () => {
        expect(formatBytes(1024 * 1024)).toBe('1 MB');
        expect(formatBytes(1024 * 1024 * 5)).toBe('5 MB');
    });

    test('formats gigabytes', () => {
        expect(formatBytes(1024 ** 3)).toBe('1 GB');
    });

    test('formats terabytes', () => {
        expect(formatBytes(1024 ** 4)).toBe('1 TB');
    });

    test('respects custom decimal places', () => {
        expect(formatBytes(1536, 0)).toBe('2 KB');
        expect(formatBytes(1536, 3)).toBe('1.5 KB');
    });

    test('treats negative decimal as 0 decimals', () => {
        expect(formatBytes(1536, -1)).toBe('2 KB');
    });

    test('handles large values', () => {
        const result = formatBytes(1024 ** 4 * 2.5);
        expect(result).toContain('TB');
    });
});

// ── formatUptime ──────────────────────────────────────────────────────────────

describe('formatUptime', () => {
    test('returns "0s" for falsy input', () => {
        expect(formatUptime(null)).toBe('0s');
        expect(formatUptime(undefined)).toBe('0s');
        expect(formatUptime('')).toBe('0s');
    });

    test('parses days', () => {
        expect(formatUptime('2d')).toBe('2d');
    });

    test('parses hours', () => {
        expect(formatUptime('3h')).toBe('3h');
    });

    test('parses minutes', () => {
        expect(formatUptime('15m')).toBe('15m');
    });

    test('parses seconds', () => {
        expect(formatUptime('45s')).toBe('45s');
    });

    test('parses full MikroTik format', () => {
        expect(formatUptime('2d3h15m40s')).toBe('2d 3h 15m 40s');
    });

    test('parses partial format — days and hours only', () => {
        expect(formatUptime('1d2h')).toBe('1d 2h');
    });

    test('parses partial format — hours and minutes only', () => {
        expect(formatUptime('5h30m')).toBe('5h 30m');
    });

    test('handles single digit values', () => {
        expect(formatUptime('1d1h1m1s')).toBe('1d 1h 1m 1s');
    });

    test('handles large day counts', () => {
        expect(formatUptime('365d')).toBe('365d');
    });
});
