
/**
 * Memory Store
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');
const { Logger } = require('../utils/logger');

class MemoryStore {
  constructor(options = {}) {
    this.basePath = options.basePath || path.join(process.cwd(), 'data/memory');
    this.logger = new Logger('MemoryStore');
  }
  
  async initialize() {
    await fs.mkdir(this.basePath, { recursive: true });
  }
  
  /**
   * Append entry to memory log
   */
  async append(sessionId, entry) {
    const memoryPath = this.getMemoryPath(sessionId);
    await fs.mkdir(path.dirname(memoryPath), { recursive: true });
    
    // Append as JSONL for structured data
    const line = JSON.stringify({
      ...entry,
      timestamp: entry.timestamp || Date.now()
    }) + '\\n';
    
    await fs.appendFile(memoryPath, line);
  }
  
  /**
   * Read memory entries
   */
  async read(sessionId, options = {}) {
    const memoryPath = this.getMemoryPath(sessionId);
    
    try {
      const content = await fs.readFile(memoryPath, 'utf8');
      const lines = content.split('\\n').filter(Boolean);
      const entries = lines.map(line => JSON.parse(line));
      
      if (options.limit) {
        return entries.slice(-options.limit);
      }
      if (options.since) {
        return entries.filter(e => e.timestamp > options.since);
      }
      
      return entries;
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }
  
  /**
   * Write structured memory as YAML
   */
  async writeYAML(key, data) {
    const yamlPath = path.join(this.basePath, `${key}.yaml`);
    const content = yaml.dump(data, { indent: 2 });
    await fs.writeFile(yamlPath, content);
  }
  
  /**
   * Read structured memory from YAML
   */
  async readYAML(key) {
    const yamlPath = path.join(this.basePath, `${key}.yaml`);
    
    try {
      const content = await fs.readFile(yamlPath, 'utf8');
      return yaml.load(content);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  
  /**
   * Write human-readable memory as Markdown
   */
  async writeMarkdown(key, content) {
    const mdPath = path.join(this.basePath, `${key}.md`);
    await fs.writeFile(mdPath, content);
  }
  
  /**
   * Read Markdown memory
   */
  async readMarkdown(key) {
    const mdPath = path.join(this.basePath, `${key}.md`);
    
    try {
      return await fs.readFile(mdPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  
  /**
   * Search memory (simple text search)
   */
  async search(query, sessionId = null) {
    const results = [];
    const searchPath = sessionId ? path.dirname(this.getMemoryPath(sessionId)) : this.basePath;
    
    try {
      const files = await fs.readdir(searchPath, { recursive: true });
      
      for (const file of files) {
        if (file.endsWith('.jsonl') || file.endsWith('.md')) {
          const filePath = path.join(searchPath, file);
          const content = await fs.readFile(filePath, 'utf8');
          
          if (content.toLowerCase().includes(query.toLowerCase())) {
            results.push({
              file: filePath,
              preview: content.substring(0, 200)
            });
          }
        }
      }
    } catch (error) {
      this.logger.error('Search error:', error);
    }
    
    return results;
  }
  
  /**
   * Get memory file path
   */
  getMemoryPath(sessionId) {
    const safeId = sessionId.replace(/[^a-zA-Z0-9_\\-]/g, '_');
    return path.join(this.basePath, `${safeId}.jsonl`);
  }
  
  /**
   * Export memory as conversation history
   */
  async export(sessionId, format = 'json') {
    const entries = await this.read(sessionId);
    
    if (format === 'json') {
      return JSON.stringify(entries, null, 2);
    }
    
    if (format === 'markdown') {
      return entries.map(e => {
        const date = new Date(e.timestamp).toISOString();
        return `## ${date}\\n\\n**Input:** ${e.input}\\n\\n**Output:** ${e.output}\\n`;
      }).join('\\n---\\n\\n');
    }
    
    return entries;
  }
}

module.exports = { MemoryStore };

