'use strict';

const EventEmitter = require('events');

// Mock the routeros-client
jest.mock('routeros-client', () => {
    const EventEmitter = require('events');
    return {
        RouterOSClient: class extends EventEmitter {
            constructor() { 
                super();
                this.connected = true;
            }
            connect() { return Promise.resolve(this); }
            disconnect() { 
                this.connected = false; 
                this.emit('disconnected');
                return Promise.resolve(); 
            }
            removeAllListeners() { return this; }
            menu(path) {
                return {
                    where: (field, value) => ({
                        get: () => {
                            if (path === '/ip/hotspot/user') {
                                return Promise.resolve([{
                                    name: 'test-user',
                                    '.id': '*1',
                                    'bytes-in': '1024',
                                    'bytes-out': '2048',
                                    uptime: '1d2h3m4s',
                                    'limit-bytes-total': '10M',
                                    'limit-uptime': '2d',
                                    disabled: 'false'
                                }]);
                            }
                            if (path === '/ip/hotspot/active') {
                                return Promise.resolve([{
                                    user: 'test-user',
                                    address: '192.168.1.10',
                                    uptime: '00:05:00',
                                    'bytes-in': '512',
                                    'bytes-out': '256',
                                    'mac-address': '00:11:22:33:44:55'
                                }]);
                            }
                            return Promise.resolve([]);
                        }
                    }),
                    get: () => Promise.resolve([])
                };
            }
        }
    };
});

jest.mock('../../src/core/logger', () => ({ 
    logger: { 
        info: jest.fn(), 
        warn: jest.fn(), 
        error: jest.fn(), 
        debug: jest.fn(), 
        cyber: jest.fn() 
    } 
}));

jest.mock('../../src/core/config', () => ({ 
    getConfig: () => ({ mikrotik: {} }) 
}));

const { MikroTikManager } = require('../../src/core/mikrotik');

describe('MikroTikManager — getUserStats', () => {
    let manager;

    beforeEach(async () => {
        manager = new MikroTikManager({ host: '127.0.0.1', user: 'admin', password: '' });
        await manager.connect();
    });

    afterEach(() => {
        manager.destroy();
    });

    test('should parse user stats correctly', async () => {
        const stats = await manager.getUserStats('test-user');
        
        expect(stats.success).toBe(true);
        expect(stats.username).toBe('test-user');
        expect(stats.bytesIn).toBe(1024);
        expect(stats.bytesOut).toBe(2048);
        expect(stats.bytesTotal).toBe(3072);
        // 1d = 86400, 2h = 7200, 3m = 180, 4s = 4 -> total 93784
        expect(stats.uptime).toBe(93784);
        expect(stats.limitBytesTotal).toBe(10 * 1024 * 1024);
        expect(stats.limitUptime).toBe(2 * 86400);
    });

    test('should include session data when active', async () => {
        const stats = await manager.getUserStats('test-user');
        
        expect(stats.isActive).toBe(true);
        expect(stats.session).toBeDefined();
        expect(stats.session.address).toBe('192.168.1.10');
        expect(stats.session.uptime).toBe(300); // 00:05:00 = 5 mins
        expect(stats.session.bytesIn).toBe(512);
    });
});
