// src/core/SessionManager.js
'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');

class SessionManager extends EventEmitter {
  constructor(storage = new Map()) {
    super();
    this.sessions = storage;
  }

  async createSession(config) {
    const session = {
      id: crypto.randomUUID(),
      domain: config.domain,
      worktree: await this.createWorktree(config),
      state: 'initializing',
      checkpoint: null,
      recoverable: true,
      retryCount: 0,
      createdAt: Date.now()
    };

    await this.atomicWrite(session);
    this.emit('session.created', { sessionId: session.id, domain: session.domain });
    return session;
  }

  async createWorktree(config) {
    // Placeholder: implement actual worktree creation
    return `/tmp/agentos/${config.domain || 'default'}/${Date.now()}`;
  }

  async atomicWrite(session) {
    this.sessions.set(session.id, session);
  }

  async getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  async transition(sessionId, toState) {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const validTransitions = this.getValidTransitions(session.state);
    if (!validTransitions.includes(toState)) {
      throw new Error(`Invalid transition: ${session.state} -> ${toState}`);
    }

    const fromState = session.state;
    session.state = toState;
    session.checkpoint = Date.now();
    
    await this.atomicWrite(session);
    this.emit('session.transition', { sessionId, fromState, toState, timestamp: session.checkpoint });
    
    return session;
  }

  getValidTransitions(fromState) {
    const transitions = {
      'initializing': ['running', 'failed'],
      'running': ['paused', 'completed', 'failed'],
      'paused': ['running', 'failed'],
      'failed': ['initializing', 'terminated'],
      'completed': ['terminated'],
      'terminated': []
    };
    return transitions[fromState] || [];
  }

  getAll() {
    return Array.from(this.sessions.values());
  }
}

module.exports = SessionManager;
