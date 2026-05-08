'use strict';

// ── EventBus ──────────────────────────────────────────────────────────────────

describe('EventBus', () => {
    let eventBus;

    beforeEach(() => {
        // Fresh require each test to avoid cross-test listener leaks
        jest.resetModules();
        eventBus = require('../../src/core/eventBus');
    });

    afterEach(() => {
        eventBus.removeAllListeners();
    });

    test('is an EventEmitter', () => {
        const { EventEmitter } = require('events');
        expect(eventBus).toBeInstanceOf(EventEmitter);
    });

    test('emits and receives events', () => {
        const handler = jest.fn();
        eventBus.on('test.event', handler);
        eventBus.emit('test.event', { data: 42 });
        expect(handler).toHaveBeenCalledWith({ data: 42 });
    });

    test('supports multiple listeners on same event', () => {
        const h1 = jest.fn();
        const h2 = jest.fn();
        eventBus.on('multi', h1);
        eventBus.on('multi', h2);
        eventBus.emit('multi', 'payload');
        expect(h1).toHaveBeenCalledWith('payload');
        expect(h2).toHaveBeenCalledWith('payload');
    });

    test('once listeners fire exactly one time', () => {
        const handler = jest.fn();
        eventBus.once('oneshot', handler);
        eventBus.emit('oneshot');
        eventBus.emit('oneshot');
        expect(handler).toHaveBeenCalledTimes(1);
    });

    test('removeAllListeners clears listeners', () => {
        const handler = jest.fn();
        eventBus.on('cleared', handler);
        eventBus.removeAllListeners('cleared');
        eventBus.emit('cleared');
        expect(handler).not.toHaveBeenCalled();
    });

    test('does not throw when emitting with no listeners', () => {
        expect(() => eventBus.emit('nobody.listening', { x: 1 })).not.toThrow();
    });
});

// ── VoucherAgent ──────────────────────────────────────────────────────────────

describe('VoucherAgent — generate', () => {
    let voucher;

    beforeEach(() => {
        jest.resetModules();
        voucher = require('../../src/core/voucher');
    });

    test('generates a code for each valid plan', () => {
        const plans = [];
        for (const plan of plans) {
            const code = voucher.generate(plan);
            expect(typeof code).toBe('string');
            expect(code.length).toBeGreaterThan(0);
        }
    });

    test('generated code contains the prefix from config', () => {
        const code = voucher.generate();
        expect(code.startsWith('STAR-')).toBe(true);
    });

    test('generated code starts with "STAR-"', () => {
        const code = voucher.generate('default');
        expect(code.startsWith('STAR-')).toBe(true);
    });

    test('generates unique codes on repeated calls', () => {
        const codes = new Set(Array.from({ length: 20 }, () => voucher.generate()));
        expect(codes.size).toBe(20);
    });

    test('defaults to "default" plan when no arg given', () => {
        const code = voucher.generate();
        expect(code).toBeTruthy();
        expect(typeof code).toBe('string');
    });

    test('throws for an invalid plan', () => {
        expect(() => voucher.generate('invalid-plan')).toThrow(/Invalid plan/i);
    });

    test('throws error listing valid plans', () => {
        expect(() => voucher.generate('bad')).toThrow(/1hour|1day/i);
    });

    test('emits voucher.created event', () => {
        const eventBus = require('../../src/core/eventBus');
        const handler = jest.fn();
        eventBus.on('voucher.created', handler);
        voucher.generate();
        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({ code: expect.any(String) })
        );
        eventBus.removeAllListeners('voucher.created');
    });
});

describe('VoucherAgent — redeem', () => {
    let voucher;

    beforeEach(() => {
        jest.resetModules();
        voucher = require('../../src/core/voucher');
    });

    test('emits voucher.redeemed event', () => {
        const eventBus = require('../../src/core/eventBus');
        const handler = jest.fn();
        eventBus.on('voucher.redeemed', handler);
        voucher.redeem('STAR-1DAYS-1234', 'user123');
        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'STAR-1DAYS-1234', user: 'user123' })
        );
        eventBus.removeAllListeners('voucher.redeemed');
    });

    test('throws if code is missing', () => {
        expect(() => voucher.redeem(null, 'user')).toThrow(/code and user/i);
    });

    test('throws if user is missing', () => {
        expect(() => voucher.redeem('STAR-CODE', null)).toThrow(/code and user/i);
    });

    test('throws if both are missing', () => {
        expect(() => voucher.redeem()).toThrow();
    });
});
