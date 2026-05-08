const fs = require('fs/promises');
const { glob } = require('glob');

const rollback = {
  name: "rollback",
  description: "List or restore AgentOS self-edit backups. Emergency undo for bad self-modifications.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "restore", "diff"] },
      backup_file: { type: "string" }
    },
    required: ["action"]
  },

  run: async ({ action, backup_file }) => {
    const backups = await glob('./{skills,agents,knowledge}/**/*.bak.*');

    if (action === 'list') {
      if (backups.length === 0) return { message: "✅ No self-edit backups found." };
      const list = await Promise.all(backups.map(async (b) => {
        const stat = await fs.stat(b);
        const original = b.replace(/\.bak\.\d+$/, '');
        const timestamp = b.match(/\.bak\.(\d+)$/)[1];
        return { backup: b, original, date: new Date(parseInt(timestamp)).toISOString(), size_kb: (stat.size / 1024).toFixed(1) };
      }));
      list.sort((a, b) => b.date.localeCompare(a.date));
      let msg = `📦 *AgentOS Self-Edit Backups*\n\n`;
      list.forEach((b, i) => {
        msg += `**${i + 1}.** \`${b.original}\`\n _Backup: ${b.date}_\n _Restore: \`rollback restore ${b.backup}\`_\n\n`;
      });
      return { success: true, message: msg + `_Total: ${list.length} backups_`, backups: list };
    }

    if (action === 'restore') {
      if (!backup_file ||!backups.includes(backup_file)) throw new Error('Backup not found');
      const original = backup_file.replace(/\.bak\.\d+$/, '');
      const safetyBackup = `${original}.bak.pre-restore.${Date.now()}`;
      await fs.copyFile(original, safetyBackup);
      await fs.copyFile(backup_file, original);
      await fs.appendFile('./knowledge/soul.md',
        `\n## Rollback ${new Date().toISOString()}\nRestored: ${original}\nFrom: ${backup_file}\n`);
      return { success: true, message: `✅ Rolled back: \`${original}\`\nSafety backup: \`${safetyBackup}\`\n⚠️ Restart to apply.` };
    }

    if (action === 'diff') {
      const original = backup_file.replace(/\.bak\.\d+$/, '');
      const [oldCode, newCode] = await Promise.all([fs.readFile(backup_file, 'utf8'), fs.readFile(original, 'utf8')]);
      const diff = `📊 *Diff: ${original}*\n\n**Before:** ${oldCode.length} chars\n**After:** ${newCode.length} chars\n\n\`\`\`js\n${newCode.slice(0, 500)}\n\`\`\``;
      return { success: true, message: diff };
    }
  }
};

module.exports = { rollback };
