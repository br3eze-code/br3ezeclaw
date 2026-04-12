// src/core/SessionManager.js
class SessionManager {
  async createSession(config) {
    const session = {
      id: crypto.randomUUID(),
      domain: config.domain,
      worktree: await this.createWorktree(config),
      state: 'initializing',
      checkpoint: null,
      recoverable: true,
      retryCount: 0
    };

    // Atomic initialization
    await this.atomicWrite(session);
    return session;
  }

  // State machine for session lifecycle
  async transition(sessionId, toState) {
    const session = await this.getSession(sessionId);
    const validTransitions = this.getValidTransitions(session.state);
    
    if (!validTransitions.includes(toState)) {
      throw new Error(`Invalid transition: ${session.state} -> ${toState}`);
    }

    session.state = toState;
    session.checkpoint = Date.now();
    await this.atomicWrite(session);
    
    this.emitEvent('session.transition', { sessionId, toState });
  }
}
