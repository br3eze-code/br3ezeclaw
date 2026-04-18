// src/core/heartbeat.js
const fs = require('fs').promises;
const path = require('path');
class HeartbeatScheduler {
  constructor(agentRuntime) {
    this.interval = process.env.HEARTBEAT_INTERVAL || 1800000; // 30min
    this.checklistPath = path.join(process.cwd(), 'HEARTBEAT.md');
    this.runtime = agentRuntime;
  }
  
  start() {
    setInterval(() => this.tick(), this.interval);
  }
  
  async tick() {
    if (!fs.existsSync(this.checklistPath)) return;
    
    const checklist = await fs.readFile(this.checklistPath, 'utf8');
    
    // Agent decides if action needed
    const decision = await this.runtime.execute({
      input: {
        role: 'system',
        content: `Review this checklist and decide if any items require action:\n${checklist}`
      },
      tools: [{ name: 'noop', description: 'No action needed' }]
    });
    
    if (decision.action !== 'noop') {
      await this.notifyUser(decision);
    }
  }
}
