// Mock Firebase
jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
  firestore: Object.assign(jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(() => Promise.resolve({ exists: false })),
        set: jest.fn(() => Promise.resolve()),
        update: jest.fn(() => Promise.resolve()),
        delete: jest.fn(() => Promise.resolve())
      })),
      where: jest.fn(() => ({
        get: jest.fn(() => Promise.resolve({ docs: [], empty: true }))
      })),
      limit: jest.fn(() => ({
        get: jest.fn(() => Promise.resolve({ docs: [] }))
      })),
      count: jest.fn(() => ({
        get: jest.fn(() => Promise.resolve({ data: () => ({ count: 0 }) }))
      }))
    })),
    settings: jest.fn(),
    runTransaction: jest.fn(cb => cb({ get: jest.fn(), set: jest.fn(), update: jest.fn() }))
  })), {
    FieldValue: { serverTimestamp: jest.fn(), arrayUnion: jest.fn() }
  })
}));

// Mock MikroTik
jest.mock('routeros-client', () => ({
  RouterOSClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue({}),
    menu: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue([]),
      where: jest.fn().mockReturnThis(),
      set: jest.fn().mockResolvedValue({}),
      add: jest.fn().mockResolvedValue({})
    }),
    write: jest.fn().mockResolvedValue([]),
    disconnect: jest.fn().mockResolvedValue({})
  }))
}));

// Mock Telegram bot — prevents real HTTP polling
jest.mock('node-telegram-bot-api', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    sendMessage: jest.fn().mockResolvedValue({}),
    stopPolling: jest.fn().mockResolvedValue({}),
    isPolling: jest.fn().mockReturnValue(false)
  }));
});

// Mock WhatsApp / Baileys — prevents real WebSocket connections
jest.mock('@whiskeysockets/baileys', () => ({
  makeWASocket: jest.fn().mockReturnValue({
    ev: { on: jest.fn(), off: jest.fn() },
    sendMessage: jest.fn().mockResolvedValue({}),
    logout: jest.fn().mockResolvedValue({}),
    end: jest.fn(),
    ws: { close: jest.fn() }
  }),
  useMultiFileAuthState: jest.fn().mockResolvedValue({
    state: {},
    saveCreds: jest.fn()
  }),
  DisconnectReason: { loggedOut: 401, restartRequired: 515 },
  fetchLatestBaileysVersion: jest.fn().mockResolvedValue({ version: [2, 3000, 0], isLatest: true })
}), { virtual: true });

// Mock ChannelManager.initialize to skip real channel setup
jest.mock('../src/core/channels/ChannelManager', () => {
  const EventEmitter = require('events');
  class MockChannelManager extends EventEmitter {
    constructor(agent) {
      super();
      this.agent = agent;
      this.channels = new Map();
    }
    async initialize() {}
    async closeAll() {}
    getStatus() { return {}; }
    getRegisteredTypes() { return []; }
    async send() {}
    async broadcast() {}
  }
  MockChannelManager.adapters = new Map();
  MockChannelManager.registerAdapter = jest.fn();
  return MockChannelManager;
});

const AgentOS = require('../src/core/AgentOS');

jest.setTimeout(30000);

describe('AgentOS', () => {
  let agent;

  beforeEach(async () => {
    agent = new AgentOS({
      memoryAdapter: 'memory',
      llmProvider: 'local'
    });
    await agent.initialize();
  });

  afterEach(async () => {
    await agent.destroy();
  });

  test('initializes with skills', () => {
    expect(agent.skills.count()).toBeGreaterThan(0);
  });

  test('processes interaction', async () => {
    const result = await agent.processInteraction({
      action: 'test.echo',
      params: { message: 'hello' },
      userId: 'test-user'
    });

    expect(result.success).toBe(true);
  });

  test('handles unknown skill', async () => {
    const result = await agent.processInteraction({
      action: 'unknown.skill',
      userId: 'test-user'
    });

    expect(result.success).toBe(false);
  });
});
