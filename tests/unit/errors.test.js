'use strict';

const { ErrorCodes, AgentOSError } = require('../../src/core/errors');

// ── ErrorCodes ────────────────────────────────────────────────────────────────

describe('ErrorCodes', () => {
    test('connection errors are in the 1000 range', () => {
        expect(ErrorCodes.CONNECTION_REFUSED).toBe(1001);
        expect(ErrorCodes.CONNECTION_TIMEOUT).toBe(1002);
        expect(ErrorCodes.AUTH_FAILED).toBe(1003);
    });

    test('tool errors are in the 2000 range', () => {
        expect(ErrorCodes.TOOL_NOT_FOUND).toBe(2001);
        expect(ErrorCodes.TOOL_INVALID_PARAMS).toBe(2002);
        expect(ErrorCodes.TOOL_EXECUTION_FAILED).toBe(2003);
    });

    test('validation errors are in the 3000 range', () => {
        expect(ErrorCodes.VALIDATION_ERROR).toBe(3001);
        expect(ErrorCodes.RATE_LIMITED).toBe(3002);
    });

    test('system errors are in the 9000 range', () => {
        expect(ErrorCodes.INTERNAL_ERROR).toBe(9001);
        expect(ErrorCodes.NOT_IMPLEMENTED).toBe(9002);
    });

    test('all codes are unique', () => {
        const values = Object.values(ErrorCodes);
        const unique  = new Set(values);
        expect(unique.size).toBe(values.length);
    });

    test('all codes are positive integers', () => {
        for (const code of Object.values(ErrorCodes)) {
            expect(Number.isInteger(code)).toBe(true);
            expect(code).toBeGreaterThan(0);
        }
    });
});

// ── AgentOSError ──────────────────────────────────────────────────────────────

describe('AgentOSError — constructor', () => {
    test('extends Error', () => {
        const err = new AgentOSError(ErrorCodes.INTERNAL_ERROR, 'boom');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(AgentOSError);
    });

    test('sets message correctly', () => {
        const err = new AgentOSError(ErrorCodes.AUTH_FAILED, 'bad credentials');
        expect(err.message).toBe('bad credentials');
    });

    test('sets code correctly', () => {
        const err = new AgentOSError(ErrorCodes.TOOL_NOT_FOUND, 'not found');
        expect(err.code).toBe(ErrorCodes.TOOL_NOT_FOUND);
    });

    test('defaults details to empty object', () => {
        const err = new AgentOSError(ErrorCodes.INTERNAL_ERROR, 'oops');
        expect(err.details).toEqual({});
    });

    test('stores custom details', () => {
        const details = { tool: 'ping', host: '192.0.2.1' };
        const err = new AgentOSError(ErrorCodes.TOOL_EXECUTION_FAILED, 'failed', details);
        expect(err.details).toEqual(details);
    });

    test('has an ISO timestamp', () => {
        const err = new AgentOSError(ErrorCodes.INTERNAL_ERROR, 'ts');
        expect(new Date(err.timestamp).toISOString()).toBe(err.timestamp);
    });

    test('name is AgentOSError', () => {
        const err = new AgentOSError(ErrorCodes.INTERNAL_ERROR, 'n');
        expect(err.name).toBe('AgentOSError');
    });
});

describe('AgentOSError — toJSON', () => {
    test('returns correct shape', () => {
        const err = new AgentOSError(ErrorCodes.RATE_LIMITED, 'slow down', { limit: 100 });
        const json = err.toJSON();
        expect(json.error).toBe(true);
        expect(json.code).toBe(ErrorCodes.RATE_LIMITED);
        expect(json.message).toBe('slow down');
        expect(json.details).toEqual({ limit: 100 });
        expect(typeof json.timestamp).toBe('string');
    });

    test('is JSON-serialisable', () => {
        const err = new AgentOSError(ErrorCodes.INTERNAL_ERROR, 'serialise me');
        expect(() => JSON.stringify(err.toJSON())).not.toThrow();
    });

    test('can be used in catch blocks like a normal error', () => {
        expect(() => {
            throw new AgentOSError(ErrorCodes.CONNECTION_REFUSED, 'refused');
        }).toThrow(AgentOSError);
    });
});
