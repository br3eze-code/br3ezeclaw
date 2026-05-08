// src/core/sessions.js
class SessionManager {
  constructor() {
    this.mode = process.env.SECURE_DM_MODE ? 'isolated' : 'shared';
    this.basePath = path.join(os.homedir(), '.br3ezeclaw', 'sessions');
  }
  
  getSessionId(frame) {
    if (this.mode === 'isolated' && frame.isDM) {
      // Secure DM mode: isolate per sender
      return `${frame.agentId}/${frame.senderId}/main`;
    }
    // Default: shared DM session
    return `${frame.agentId}/main`;
  }
  
  async load(sessionId) {
    const sessionPath = path.join(this.basePath, `${sessionId}.jsonl`);
    
    // Lazy load from disk
    if (fs.existsSync(sessionPath)) {
      const lines = await fs.readFile(sessionPath, 'utf8');
      return lines.split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));
    }
    return [];
  }
  
  async append(sessionId, entry) {
    const sessionPath = path.join(this.basePath, `${sessionId}.jsonl`);
    await fs.appendFile(sessionPath, JSON.stringify(entry) + '\n');
  }
  
  // Memory compaction to prevent infinite growth
  async compact(sessionId, keepLast = 20) {
    const history = await this.load(sessionId);
    const systemPrompt = history.find(h => h.role === 'system');
    const recent = history.slice(-keepLast);
    
    // Summarize older context
    const summary = await this.summarize(history.slice(0, -keepLast));
    
    const compacted = [
      systemPrompt,
      { role: 'system', content: `Previous context: ${summary}` },
      ...recent
    ];
    
    await this.save(sessionId, compacted);
  }
}
