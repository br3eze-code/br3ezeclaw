'use strict';

const { MikroTikManager, ToolExecutionError } = require('../../src/core/mikrotik');
const { logger } = require('../../src/core/logger');

// Mock dependencies
jest.mock('../../src/core/logger', () => ({
    logger: {
        info:  jest.fn(),
        warn:  jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        cyber: jest.fn(),
        audit: jest.fn()
    }
}));

jest.mock('../../src/core/config', () => ({
    getConfig: jest.fn(() => ({
        tools: { mikrotik: { connection: { host: '192.168.88.1' } } }
    }))
}));

jest.mock('../../src/core/database', () => ({
    getDatabase: jest.fn()
}));

const mockMenu = {
    get: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    update: jest.fn(),
    set: jest.fn(),
    where: jest.fn().mockReturnThis()
};

const mockConn = {
    menu: jest.fn(() => mockMenu),
    write: jest.fn(),
    close: jest.fn()
};

const mockClient = {
    connect: jest.fn().mockResolvedValue(mockConn),
    disconnect: jest.fn(),
    on: jest.fn(),
    removeAllListeners: jest.fn()
};

jest.mock('routeros-client', () => ({
    RouterOSClient: jest.fn(() => mockClient)
}));

describe('MikroTikManager Logic', () => {
    let manager;

    beforeEach(async () => {
        jest.clearAllMocks();
        manager = new MikroTikManager();
        await manager.connect();
    });

    afterEach(() => {
        manager.disconnect();
    });

    describe('addHotspotUser', () => {
        test('adds a new user with default profile', async () => {
            mockMenu.get.mockResolvedValueOnce([{ 'dns-name': 'hotspot.local' }]); // 1. Profiles for DNS name
            mockMenu.get.mockResolvedValueOnce([]); // 2. No existing user
            mockMenu.add.mockResolvedValueOnce('*1'); // Return ID

            const result = await manager.addHotspotUser('testuser', 'password123');

            expect(mockMenu.add).toHaveBeenCalledWith({
                name: 'testuser',
                password: 'password123',
                profile: 'default',
                disabled: 'no'
            });
            expect(result).toBe('http://hotspot.local/login?username=testuser&password=password123');
        });

        test('updates an existing user', async () => {
            mockMenu.get.mockResolvedValueOnce([{ 'dns-name': 'hotspot.local' }]); // 1. Profiles for DNS name
            mockMenu.get.mockResolvedValueOnce([{ '.id': '*1', name: 'testuser' }]); // 2. Existing user

            await manager.addHotspotUser('testuser', 'newpassword');

            expect(mockMenu.update).toHaveBeenCalledWith('*1', {
                password: 'newpassword',
                profile: 'default',
                disabled: 'no'
            });
        });

        test('falls back to default profile if requested profile is missing', async () => {
            mockMenu.get.mockResolvedValueOnce([]); // 1. Profiles for DNS name
            mockMenu.get.mockResolvedValueOnce([]); // 2. No existing user
            mockMenu.add.mockRejectedValueOnce(new Error('does not match any value of profile')); // First attempt fails
            mockMenu.add.mockResolvedValueOnce('*1'); // Second attempt (fallback) succeeds

            await manager.addHotspotUser({ username: 'testuser', password: 'pw', profile: '7Day' });

            expect(mockMenu.add).toHaveBeenCalledTimes(2);
            expect(mockMenu.add).toHaveBeenNthCalledWith(1, expect.objectContaining({ profile: '7Day' }));
            expect(mockMenu.add).toHaveBeenNthCalledWith(2, expect.objectContaining({ profile: 'default' }));
        });
    });

    describe('kickUser', () => {
        test('kicks an active user', async () => {
            mockMenu.get.mockResolvedValueOnce([{ '.id': '*A1', user: 'activeuser' }]);

            const result = await manager.kickUser('activeuser');

            expect(mockMenu.remove).toHaveBeenCalledWith('*A1');
            expect(result.kicked).toBe(true);
        });

        test('returns false if user is not active', async () => {
            mockMenu.get.mockResolvedValueOnce([]);

            const result = await manager.kickUser('inactiveuser');

            expect(mockMenu.remove).not.toHaveBeenCalled();
            expect(result.kicked).toBe(false);
        });
    });

    describe('getSystemStats', () => {
        test('returns normalized stats', async () => {
            mockMenu.get.mockResolvedValueOnce([{
                'cpu-load': '10%',
                'total-memory': '128000000',
                'free-memory': '64000000',
                'uptime': '1d00:00:00',
                'version': '7.12'
            }]);

            const stats = await manager.getSystemStats(true);

            expect(stats['cpu-load']).toBe(10);
            expect(stats['total-memory']).toBe(128000000);
            expect(stats['memory-usage-percent']).toBe("50");
            expect(stats.uptime).toBe('1d00:00:00');
        });
    });

    describe('executeTool', () => {
        test('executes a registered tool', async () => {
            mockMenu.get.mockResolvedValueOnce([{ 'cpu-load': '5' }]);

            const result = await manager.executeTool('system.stats');

            expect(result['cpu-load']).toBe(5);
        });

        test('throws error for unknown tool', async () => {
            await expect(manager.executeTool('nonexistent.tool'))
                .rejects.toThrow(ToolExecutionError);
        });

        test('circuit breaker opens after failures', async () => {
            // Force 10 failures to open the circuit breaker (default threshold is 10)
            mockMenu.get.mockRejectedValue(new Error('connection refused'));

            for (let i = 0; i < 10; i++) {
                await expect(manager.executeTool('system.stats')).rejects.toThrow();
            }

            // Next call should be blocked by circuit breaker
            await expect(manager.executeTool('system.stats'))
                .rejects.toThrow('Circuit breaker is OPEN');
        });
    });
});
