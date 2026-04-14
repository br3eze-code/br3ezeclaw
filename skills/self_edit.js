const fs = require('fs/promises');
const path = require('path');
const { execSync } = require('child_process');

const SAFE_DIRS = ['./skills', './agents', './knowledge'];
const FORBIDDEN = ['/system', '/etc', 'package.json', 'node_modules', '.env'];

const self_edit = {
  name: "self_edit",
  description: "CRITICAL: Modify AgentOS source files to fix bugs or add features.",
  parameters: {
    type: "object",
    properties: {
      file: { type: "string" },
      reason: { type: "string" },
      operation: { type: "string", enum: ["replace", "append", "create"] },
      code: { type: "string" }
    },
    required: ["file", "reason", "operation", "code"]
  },

  run: async ({ file, reason, operation, code }, { logger, gemini }) => {
    const soul = await fs.readFile('./knowledge/soul.md', 'utf8');
    if (!soul.includes('self_edit enabled: true')) {
      throw new Error('Blocked: self_edit not authorized. Run /freeze unfreeze first.');
    }

    const absPath = path.resolve(file);
    const isSafe = SAFE_DIRS.some(dir => absPath.startsWith(path.resolve(dir)));
    const isForbidden = FORBIDDEN.some(bad => absPath.includes(bad));
    if (!isSafe || isForbidden) throw new Error(`Blocked: Cannot edit ${file}`);

    const review = await gemini.generate({
      prompt: `Review this self-edit. Is it safe per soul.md?\nFile: ${file}\nReason: ${reason}\nCode:\n${code.slice(0, 2000)}\nReply: SAFE or UNSAFE`
    });
    if (!review.text.includes('SAFE')) throw new Error(`Blocked by Gemini: ${review.text}`);

    const backup = `${file}.bak.${Date.now()}`;
    try { await fs.copyFile(absPath, backup); } catch {}

    if (operation === 'replace' || operation === 'create') await fs.writeFile(absPath, code);
    else await fs.appendFile(absPath, '\n' + code);

    await fs.appendFile('./knowledge/soul.md',
      `\n## Self-Edit ${new Date().toISOString()}\nFile: ${file}\nReason: ${reason}\nBackup: ${backup}\n`);

    if (file.endsWith('.js')) {
      try { execSync(`node --check ${absPath}`); }
      catch (e) {
        await fs.copyFile(backup, absPath);
        throw new Error(`Syntax error. Rolled back. ${e.message}`);
      }
    }
    return { success: true, file, backup, warning: 'Restart required' };
  }
};

module.exports = { self_edit };
