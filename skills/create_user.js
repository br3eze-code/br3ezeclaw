const fs = require('fs/promises');
const RouterOSAPI = require('node-routeros').RouterOSAPI;

const create_user = {
  name: "create_user",
  description: "Create or update a RouterOS user on one or all routers. Supports groups: full, read, write.",
  parameters: {
    type: "object",
    properties: {
      target: { type: "string", default: "all", description: "Router id, 'all', or 'role:core'" },
      username: { type: "string", description: "Username to create" },
      password: { type: "string", description: "Password" },
      group: { type: "string", default: "read", enum: ["full", "read", "write"] },
      comment: { type: "string", default: "AgentOS: managed user" },
      disabled: { type: "boolean", default: false }
    },
    required: ["username", "password"]
  },
  run: async ({ target = "all", username, password, group = "read", comment = "AgentOS: managed user", disabled = false }, { logger }) => {
    const inventory = JSON.parse(await fs.readFile('./knowledge/inventory.json', 'utf8'));
    let targets = [];
    if (target === 'all') targets = inventory;
    else if (target.startsWith('role:')) targets = inventory.filter(r => r.role === target.split(':')[1]);
    else targets = inventory.filter(r => r.id === target);
    if (targets.length === 0) throw new Error('No routers matched');

    const results = [];
    for (const router of targets) {
      const api = new RouterOSAPI({ host: router.host, user: router.user, password: router.password, timeout: 10 });
      try {
        await api.connect();
        const existing = await api.write('/user/print', [`?name=${username}`]);
        if (existing.length > 0) {
          await api.write('/user/set', [`=.id=${existing[0]['.id']}`, `=password=${password}`, `=group=${group}`, `=comment=${comment}`, `=disabled=${disabled? 'yes' : 'no'}`]);
          logger.info(`CREATE_USER: updated ${username} on ${router.id}`);
        } else {
          await api.write('/user/add', [`=name=${username}`, `=password=${password}`, `=group=${group}`, `=comment=${comment}`, `=disabled=${disabled? 'yes' : 'no'}`]);
          logger.info(`CREATE_USER: created ${username} on ${router.id}`);
        }
        await api.close();
        results.push({ id: router.id, name: router.name, success: true, action: existing.length? 'updated' : 'created' });
      } catch (err) {
        try { await api.close(); } catch {}
        await fs.appendFile('./knowledge/failed-commands.md', `\n## create_user failed ${new Date().toISOString()}\nRouter: ${router.id}\nUser: ${username}\nError: ${err.message}\n`);
        results.push({ id: router.id, name: router.name, success: false, error: err.message });
      }
      await new Promise(r => setTimeout(r, 500));
    }

    const ok = results.filter(r => r.success).length;
    let msg = `👤 *Create User: ${username}*\n\n**Group**: ${group}\n**Success**: ${ok}/${targets.length}\n\n`;
    results.forEach(r => {
      msg += r.success? `✅ ${r.name}: ${r.action}\n` : `❌ ${r.name}: ${r.error}\n`;
    });

    await fs.appendFile('./knowledge/soul.md', `\n## Create User ${new Date().toISOString()}\nUsername: ${username}\nGroup: ${group}\nTarget: ${target}\nSuccess: ${ok}/${targets.length}\n`);

    return { success: ok > 0, message: msg, results };
  }
};

module.exports = { create_user };
