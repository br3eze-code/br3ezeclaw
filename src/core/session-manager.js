/**
 * Session Manager
 */

const fs = require('fs').promises;
const path = require('path');
const { Logger } = require('../utils/logger');

class SessionManager {
  constructor(options = {}) {
    this.basePath = options.basePath || path.join(process.cwd(), 'data/sessions');
    this.mode = options.mode || 'isolated'; // 'isolated' or 'shared'
    this.logger = new Logger('SessionManager');
    this.cache = new Map();
    this.maxCacheSize = 100;
  }
  
  async initialize() {
    // Ensure base directory exists
    await fs.mkdir(this.basePath, { recursive: true });
    this.logger.info(`Session manager initialized: ${this.basePath} (${this.mode} mode)`);
  }
  
  /**
   * Get session ID for a frame
   * OpenClaw: isolated per sender in DM mode, shared in channel mode
   */
  getSessionId(frame) {
    const agentId = frame.agentId || 'default';
    
    if (this.mode === 'isolated' && frame.isDM) {
      // Secure DM mode: isolate per sender
      // Sanitize sender ID for filesystem safety
      const safeSender = frame.sender.replace(/[^a-zA-Z0-9_-]/g, '_');
      return path.join(agentId, safeSender, 'main');
    }
    
    // Shared mode or channel mode: shared session
    return path.join(agentId, 'main');
  }
  
  /**
   * Load session history
   */
  async load(sessionId) {
    // Check cache first
    if (this.cache.has(sessionId)) {
      return this.cache.get(sessionId);
    }
    
    const sessionPath = this.getSessionPath(sessionId);
    
    try {
      const content = await fs.readFile(sessionPath, 'utf8');
      const lines = content.split('\\n').filter(Boolean);
      const history = lines.map(line => JSON.parse(line));
      
      // Add to cache
      this.addToCache(sessionId, history);
      
      return history;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // New session
        return [];
      }
      throw error;
    }
  }
  
  /**
   * Save session history
   */
  async save(sessionId, history) {
    const sessionPath = this.getSessionPath(sessionId);
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    
    // Write as JSONL (one JSON object per line)
    const content = history.map(entry => JSON.stringify(entry)).join('\\n') + '\\n';
    await fs.writeFile(sessionPath, content);
    
    // Update cache
    this.addToCache(sessionId, history);
  }
  
  /**
   * Append to session
   */
  async append(sessionId, entry) {
    const sessionPath = this.getSessionPath(sessionId);
    
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    
    const line = JSON.stringify(entry) + '\\n';
    await fs.appendFile(sessionPath, line);
    
    // Update cache
    const history = this.cache.get(sessionId) || [];
    history.push(entry);
    this.addToCache(sessionId, history);
  }
  
  /**
   * Compact session to prevent infinite growth
   */
  async compact(sessionId, keepLast = 20) {
    const history = await this.load(sessionId);
    
    if (history.length <= keepLast + 5) return; // No need to compact
    
    // Find system prompt
    const systemPrompt = history.find(h => h.role === 'system');
    
    // Keep recent messages
    const recent = history.slice(-keepLast);
    
    // Create summary of older messages (simplified)
    const older = history.slice(0, -keepLast);
    const summary = this.summarizeHistory(older);
    
    const compacted = [
      systemPrompt,
      { 
        role: 'system', 
        content: `[Previous conversation summary: ${summary}]` 
      },
      ...recent
    ].filter(Boolean);
    
    await this.save(sessionId, compacted);
    this.logger.debug(`Compacted session ${sessionId}: ${history.length} -> ${compacted.length}`);
  }
  
  /**
   * Simple summarization (in production, use LLM)
   */
  summarizeHistory(history) {
    const userMessages = history.filter(h => h.role === 'user');
    const toolCalls = history.filter(h => h.role === 'tool').length;
    
    if (userMessages.length === 0) return 'No prior context';
    
    const topics = userMessages.slice(-3).map(m => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return content.substring(0, 50);
    }).join('; ');
    
    return `${userMessages.length} messages, ${toolCalls} tool calls. Recent: ${topics}...`;
  }
  
  /**
   * Clear session
   */
  async clear(sessionId) {
    const sessionPath = this.getSessionPath(sessionId);
    
    try {
      await fs.unlink(sessionPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    
    this.cache.delete(sessionId);
  }
  
  /**
   * Get session statistics
   */
  async getStats() {
    try {
      const entries = await fs.readdir(this.basePath, { recursive: true });
      const sessionFiles = entries.filter(e => e.endsWith('.jsonl'));
      
      return {
        totalSessions: sessionFiles.length,
        cachedSessions: this.cache.size,
        mode: this.mode
      };
    } catch (error) {
      return { totalSessions: 0, cachedSessions: this.cache.size, mode: this.mode };
    }
  }
  
  /**
   * Get filesystem path for session
   */
  getSessionPath(sessionId) {
    // Ensure safe path
    const safeId = sessionId.replace(/\.+/g, '.').replace(/[^a-zA-Z0-9_\-\/\\]/g, '_');
    return path.join(this.basePath, `${safeId}.jsonl`);
  }
  
  /**
   * Add to cache with LRU eviction
   */
  addToCache(sessionId, history) {
    if (this.cache.size >= this.maxCacheSize) {
      // Evict oldest
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(sessionId, history);
  }
}

module.exports = { SessionManager };

