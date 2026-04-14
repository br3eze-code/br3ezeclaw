const fs = require('fs/promises');
const RouterOSAPI = require('node-routeros').RouterOSAPI;

const hotspot_brand = {
  name: "hotspot_brand",
  description: "Upload complete hotspot portal: login.html, status.html, logout.html, rlogin.html, style.css, script.js, images. Shards to fleet.",
  parameters: {
    type: "object",
    properties: {
      target: { type: "string", description: "Router id, 'all', or 'role:branch'" },
      bundle: {
        type: "object",
        description: "File bundle to upload",
        properties: {
          login: { type: "string", description: "login.html content" },
          status: { type: "string", description: "status.html content" },
          logout: { type: "string", description: "logout.html content" },
          rlogin: { type: "string", description: "rlogin.html content (redirect after login)" },
          css: { type: "string", description: "style.css content" },
          js: { type: "string", description: "script.js content" },
          logo_base64: { type: "string", description: "base64 PNG for logo.png" },
          bg_base64: { type: "string", description: "base64 JPG for background.jpg" }
        },
        required: ["login"]
      }
    },
    required: ["target", "bundle"]
  },

  run: async ({ target, bundle }, { logger }) => {
    const inventory = JSON.parse(await fs.readFile('./knowledge/inventory.json', 'utf8'));
    let targets = [];
    if (target === 'all') targets = inventory;
    else if (target.startsWith('role:')) targets = inventory.filter(r => r.role === target.split(':')[1]);
    else targets = [inventory.find(r => r.id === target)].filter(Boolean);
    if (targets.length === 0) throw new Error('No routers matched');

    const results = [];

    for (const router of targets) {
      const api = new RouterOSAPI({ host: router.host, user: router.user, password: router.password, timeout: 30 });
      const uploaded = [];

      try {
        await api.connect();

        // Helper: backup + upload
        const pushFile = async (name, content, isBase64 = false) => {
          try {
            await api.write('/file/print', [`?name=hotspot/${name}`]);
            await api.write('/file/set', [`=numbers=hotspot/${name}`, `=name=hotspot/${name}.bak`]);
          } catch {}

          const payload = isBase64? content : content.replace(/\n/g, '\\n').replace(/"/g, '\\"');
          await api.write('/file/add', [`=name=hotspot/${name}`, `=contents=${payload}`]);
          uploaded.push(name);
        };

        // Upload all provided files
        if (bundle.login) await pushFile('login.html', bundle.login);
        if (bundle.status) await pushFile('status.html', bundle.status);
        if (bundle.logout) await pushFile('logout.html', bundle.logout);
        if (bundle.rlogin) await pushFile('rlogin.html', bundle.rlogin);
        if (bundle.css) await pushFile('style.css', bundle.css);
        if (bundle.js) await pushFile('script.js', bundle.js);
        if (bundle.logo_base64) await pushFile('logo.png', bundle.logo_base64, true);
        if (bundle.bg_base64) await pushFile('bg.jpg', bundle.bg_base64, true);

        // Force hotspot reload
        await api.write('/ip/hotspot/profile/set', ['=numbers=0', '=html-directory=hotspot']);

        await api.close();
        results.push({ id: router.id, success: true, files: uploaded });
        logger.info(`HOTSPOT_BRAND: ${router.id} uploaded ${uploaded.length} files`);

      } catch (err) {
        try { await api.close(); } catch {}
        results.push({ id: router.id, success: false, error: err.message, files: uploaded });
      }
      await new Promise(r => setTimeout(r, 800));
    }

    const ok = results.filter(r => r.success).length;
    let msg = `🎨 *Hotspot Portal Deploy*\n\n**Success**: ${ok}/${targets.length}\n\n`;
    results.forEach(r => {
      msg += r.success?
        `✅ ${r.id}: ${r.files.join(', ')}\n` :
        `❌ ${r.id}: ${r.error}\n`;
    });
    msg += `\nTest: http://${targets[0].host}/login`;

    await fs.appendFile('./knowledge/soul.md',
      `\n## Hotspot Portal Push ${new Date().toISOString()}\nTarget: ${target}\nSuccess: ${ok}/${targets.length}\nFiles: ${Object.keys(bundle).join(', ')}\n`);

    return { success: ok > 0, message: msg, results };
  }
};

module.exports = { hotspot_brand };
