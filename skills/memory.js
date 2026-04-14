const fs = require('fs/promises');
const path = require('path');

const KNOWLEDGE_DIR = './knowledge';

const memory = {
  name: "memory",
  description: "Show summaries of AgentOS memory files",
  parameters: {
    type: "object",
    properties: {
      file: { type: "string", enum: ["all", "identity", "soul", "patterns", "failed", "preferences", "topology"] }
    }
  },

  run: async ({ file = "all" }, { gemini }) => {
    const files = {
      'identity.md': 'Who I am + core directives',
      'soul.md': 'How I think + rules',
      'mikrotik-patterns.md': 'Learned RouterOS solutions',
      'failed-commands.md': 'What not to repeat',
      'user-preferences.md': 'What I know about you',
      'network-topology.md': 'Discovered network map'
    };
    const targetFiles = file === 'all'? Object.keys(files) : [`${file}.md`];
    const summaries = [];

    for (const f of targetFiles) {
      try {
        const content = await fs.readFile(path.join(KNOWLEDGE_DIR, f), 'utf8');
        const summaryRes = await gemini.generate({
          model: "gemini-2.5-flash",
          prompt: `Summarize this AgentOS memory file in 2-3 bullets. If empty say "Empty - not learned yet".\nFile: ${f}\nContent:\n${content.slice(0, 3000)}`
        });
        const lines = content.split('\n').length;
        const size = (content.length / 1024).toFixed(1);
        summaries.push({ file: f, purpose: files[f], lines, size_kb: size, summary: summaryRes.text.trim() });
      } catch {
        summaries.push({ file: f, purpose: files[f], error: 'File missing', lines: 0, size_kb: '0.0' });
      }
    }

    let msg = `🧠 *AgentOS Memory Dump*\n\n`;
    for (const s of summaries) {
      msg += `**${s.file}** _(${s.lines} lines, ${s.size_kb}KB)_\n_${s.purpose}_\n${s.error || s.summary}\n\n`;
    }
    const totalSize = summaries.reduce((acc, s) => acc + parseFloat(s.size_kb || 0), 0).toFixed(1);
    msg += `_Total memory: ${totalSize}KB_`;
    return { success: true, message: msg };
  }
};

module.exports = { memory };
