// skills/memory.js
import fs from 'fs/promises';
import path from 'path';

const KNOWLEDGE_DIR = './knowledge';

export const memory = {
  name: "memory",
  description: "Show summaries of AgentOS memory files: identity, soul, patterns, failed, preferences, topology",
  parameters: {
    type: "object",
    properties: {
      file: {
        type: "string",
        enum: ["all", "identity", "soul", "patterns", "failed", "preferences", "topology"],
        description: "Which memory to summarize. 'all' for overview"
      }
    }
  },

  run: async ({ file = "all" }, { gemini }) => {
    const files = {
      'identity.md': 'Who I am + core directives',
      'soul.md': 'How I think + rules + values',
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

        // Use Gemini to summarize each file in 2-3 bullets
        const summaryRes = await gemini.generate({
          model: "gemini-2.5-flash",
          prompt: `Summarize this AgentOS memory file in 2-3 key bullets. Be specific with numbers/names. If empty, say "Empty - not learned yet".

File: ${f}
Content:
${content.slice(0, 3000)}

Format: • Key point 1\n• Key point 2\n• Key point 3`
        });

        const lines = content.split('\n').length;
        const size = (content.length / 1024).toFixed(1);

        summaries.push({
          file: f,
          purpose: files[f],
          lines,
          size_kb: size,
          summary: summaryRes.text.trim()
        });

      } catch (err) {
        summaries.push({
          file: f,
          purpose: files[f],
          error: 'File missing or unreadable'
        });
      }
    }

    // Build final message
    let msg = `🧠 *AgentOS Memory Dump*\n\n`;

    for (const s of summaries) {
      msg += `**${s.file}** _(${s.lines} lines, ${s.size_kb}KB)_`;
      msg += `\n_${s.purpose}_`;
      if (s.error) {
        msg += `\n❌ ${s.error}\n\n`;
      } else {
        msg += `\n${s.summary}\n\n`;
      }
    }

    const totalSize = summaries.reduce((acc, s) => acc + parseFloat(s.size_kb || 0), 0).toFixed(1);
    msg += `_Total memory: ${totalSize}KB across ${summaries.length} files_`;

    return { success: true, message: msg, raw: summaries };
  }
}
