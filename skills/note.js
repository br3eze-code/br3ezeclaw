const fs = require('fs/promises');
const path = require('path');

const KNOWLEDGE_DIR = './knowledge';

const note = {
  name: "note",
  description: "Read, write, or update AgentOS knowledge base.md files.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["read", "write", "append", "search"] },
      file: { type: "string" },
      content: { type: "string" },
      query: { type: "string" }
    },
    required: ["action", "file"]
  },

  run: async ({ action, file, content, query }) => {
    await fs.mkdir(KNOWLEDGE_DIR, { recursive: true });
    const filePath = path.join(KNOWLEDGE_DIR, file);

    if (action === 'read') {
      try {
        const data = await fs.readFile(filePath, 'utf8');
        return { file, content: data };
      } catch {
        return { file, content: '', note: 'File does not exist yet' };
      }
    }
    if (action === 'write') {
      await fs.writeFile(filePath, content);
      return { success: true, action: 'wrote', file, bytes: content.length };
    }
    if (action === 'append') {
      await fs.appendFile(filePath, '\n' + content);
      return { success: true, action: 'appended', file };
    }
    if (action === 'search') {
      const files = await fs.readdir(KNOWLEDGE_DIR);
      const results = [];
      for (const f of files) {
        if (!f.endsWith('.md')) continue;
        const data = await fs.readFile(path.join(KNOWLEDGE_DIR, f), 'utf8');
        if (data.toLowerCase().includes(query.toLowerCase())) {
          results.push({ file: f, excerpt: data.slice(0, 200) });
        }
      }
      return { query, results };
    }
  }
};

module.exports = { note };
