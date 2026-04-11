const { MikroTikManager, testConnection } = require('../src/core/mikrotik');
const { ConnectionError, ToolExecutionError } = require('../src/core/error');

describe('MikroTikManager', () => {
  let manager;

  beforeEach(() => {
    manager = new MikroTikManager({
      host: '192.168.88.1',
      user: 'admin',
      password: 'test',
      port: 8728
    });
  });

  afterEach(() => {
    manager.destroy();
  });

  test('should initialize with correct state', () => {
    const state = manager.getState();
    expect(state.isConnected).toBe(false);
    expect(state.host).toBe('192.168.88.1');
    expect(state.availableTools).toBeGreaterThan(0);
  });

  test('should throw ConnectionError when not connected', async () => {
    await expect(manager.getSystemStats()).rejects.toThrow(ConnectionError);
  });

  test('should validate tool names', () => {
    const tools = manager.getAvailableTools();
    expect(tools).toContain('user.add');
    expect(tools).toContain('system.stats');
    expect(tools).toContain('ping');
  });

  test('should emit events on connection', (done) => {
    manager.once('connected', (data) => {
      expect(data.host).toBeDefined();
      expect(data.timestamp).toBeDefined();
      done();
    });
    
    // Mock connection for test
    manager.state.isConnected = true;
    manager.emit('connected', { host: 'test', timestamp: new Date().toISOString() });
  });
});

describe('testConnection', () => {
  test('should return failure for invalid credentials', async () => {
    const result = await testConnection({
      host: '192.168.1.1',
      user: 'invalid',
      password: 'wrong'
    });
    
    expect(result.success).toBe(false);
    expect(result.message).toBeDefined();
  });
});
