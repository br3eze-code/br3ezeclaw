const fs = require('fs/promises');
const path = require('path');

const skill_create = {
  name: "skill_create",
  description: "Create new AgentOS skills. Now supports templates for RouterOS file upload, fleet sharding, and multi-asset bundles.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Skill name, e.g. 'hotspot_banner'" },
      purpose: { type: "string", description: "What it does" },
      trigger: { type: "string", description: "Example user phrase that should trigger it" },
      template: { 
        type: "string", 
        enum: ["basic", "routeros_file", "fleet_shard", "hotspot_bundle"],
        description: "basic=simple skill, routeros_file=uploads files to RouterOS, fleet_shard=runs on inventory.json, hotspot_bundle=full portal deploy"
      },
      code: { type: "string", description: "Custom code if template=basic. Ignored for other templates." }
    },
    required: ["name", "purpose", "trigger", "template"]
  },

  run: async ({ name, purpose, trigger, template, code }, { gemini }) => {
    const soul = await fs.readFile('./knowledge/soul.md', 'utf8');
    if (!soul.includes('skill_create enabled: true')) {
      throw new Error('Blocked: skill_create not authorized. Run freeze unfreeze first.');
    }

    const filePath = `./skills/${name}.js`;
    let finalCode = '';

    if (template === 'basic') {
      if (!code) throw new Error('template=basic requires code parameter');
      finalCode = code;
    }

    if (template === 'routeros_file') {
      finalCode = `
const fs = require('fs/promises');
const RouterOSAPI = require('node-routeros').RouterOSAPI;

const ${name} = {
  name: "${name}",
  description: "${purpose}",
  parameters: {
    type: "object",
    properties: {
      target: { type: "string", description: "Router id or 'all'" },
      filename: { type: "string", description: "Path on router, e.g. 'hotspot/custom.html'" },
      content: { type: "string", description: "File content" }
    },
    required: ["target", "filename", "content"]
  },

  run: async ({ target, filename, content }, { logger }) => {
    const inventory = JSON.parse(await fs.readFile('./knowledge/inventory.json', 'utf8'));
    const targets = target === 'all' ? inventory : [inventory.find(r => r.id === target)].filter(Boolean);
    const results = [];

    for (const router of targets) {
      const api = new RouterOSAPI({ host: router.host, user: router.user, password: router.password, timeout: 20 });
      try {
        await api.connect();
        try { await api.write('/file/set', [\`=numbers=\${filename}\`, \`=name=\${filename}.bak\`]); } catch {}
        await api.write('/file/add', [\`=name=\${filename}\`, \`=contents=\${content.replace(/\\n/g, '\\\\n').replace(/"/g, '\\\\"')}\`]);
        await api.close();
        results.push({ id: router.id, success: true });
      } catch (err) {
        try { await api.close(); } catch {}
        results.push({ id: router.id, success: false, error: err.message });
      }
    }
    const ok = results.filter(r => r.success).length;
    return { success: ok > 0, message: \`Uploaded \${filename} to \${ok}/\${targets.length} routers\`, results };
  }
};

module.exports = { ${name} };
`;
    }

    if (template === 'fleet_shard') {
      finalCode = `
const fs = require('fs/promises');
const RouterOSAPI = require('node-routeros').RouterOSAPI;

const ${name} = {
  name: "${name}",
  description: "${purpose}",
  parameters: {
    type: "object",
    properties: {
      target: { type: "string", description: "Router id, 'all', or 'role:branch'" },
      command: { type: "string", description: "RouterOS command to run" },
      args: { type: "array", items: { type: "string" }, description: "Command arguments" }
    },
    required: ["target", "command"]
  },

  run: async ({ target, command, args = [] }, { logger }) => {
    const inventory = JSON.parse(await fs.readFile('./knowledge/inventory.json', 'utf8'));
    let targets = [];
    if (target === 'all') targets = inventory;
    else if (target.startsWith('role:')) targets = inventory.filter(r => r.role === target.split(':')[1]);
    else targets = [inventory.find(r => r.id === target)].filter(Boolean);
    
    const results = [];
    for (const router of targets) {
      const api = new RouterOSAPI({ host: router.host, user: router.user, password: router.password });
      try {
        await api.connect();
        const res = await api.write(command, args);
        await api.close();
        results.push({ id: router.id, success: true, data: res });
      } catch (err) {
        try { await api.close(); } catch {}
        results.push({ id: router.id, success: false, error: err.message });
      }
    }
    const ok = results.filter(r => r.success).length;
    return { success: ok > 0, message: \`Executed on \${ok}/\${targets.length} routers\`, results };
  }
};

module.exports = { ${name} };
`;
    }

    if (template === 'hotspot_bundle') {
      finalCode = `
const fs = require('fs/promises');
const RouterOSAPI = require('node-routeros').RouterOSAPI;

const ${name} = {
  name: "${name}",
  description: "${purpose}",
  parameters: {
    type: "object",
    properties: {
      target: { type: "string" },
      bundle: {
        type: "object",
        properties: {
          login: { type: "string" }, status: { type: "string" }, logout: { type: "string" },
          rlogin: { type: "string" }, css: { type: "string" }, js: { type: "string" },
          logo_base64: { type: "string" }, bg_base64: { type: "string" }
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
    
    const results = [];
    for (const router of targets) {
      const api = new RouterOSAPI({ host: router.host, user: router.user, password: router.password, timeout: 30 });
      const uploaded = [];
      try {
        await api.connect();
        const pushFile = async (name, content, isBase64 = false) => {
          try { await api.write('/file/set', [\`=numbers=hotspot/\${name}\`, \`=name=hotspot/\${name}.bak\`]); } catch {}
          const payload = isBase64 ? content : content.replace(/\\n/g, '\\\\n').replace(/"/g, '\\\\"');
          await api.write('/file/add', [\`=name=hotspot/\${name}\`, \`=contents=\${payload}\`]);
          uploaded.push(name);
        };
        if (bundle.login) await pushFile('login.html', bundle.login);
        if (bundle.status) await pushFile('status.html', bundle.status);
        if (bundle.logout) await pushFile('logout.html', bundle.logout);
        if (bundle.rlogin) await pushFile('rlogin.html', bundle.rlogin);
        if (bundle.css) await pushFile('style.css', bundle.css);
        if (bundle.js) await pushFile('script.js', bundle.js);
        if (bundle.logo_base64) await pushFile('logo.png', bundle.logo_base64, true);
        if (bundle.bg_base64) await pushFile('bg.jpg', bundle.bg_base64, true);
        await api.write('/ip/hotspot/profile/set', ['=numbers=0', '=html-directory=hotspot']);
        await api.close();
        results.push({ id: router.id, success: true, files: uploaded });
      } catch (err) {
        try { await api.close(); } catch {}
        results.push({ id: router.id, success: false, error: err.message });
      }
    }
    const ok = results.filter(r => r.success).length;
    return { success: ok > 0, message: \`Portal deployed to \${ok}/\${targets.length} routers\`, results };
  }
};

module.exports = { ${name} };
`;
    }

    // Validate generated code
    const validation = await gemini.generate({
      prompt: `Validate AgentOS skill. Must export { ${name} } with name,description,parameters,run. Check RouterOS safety, no system paths, no eval. Reply: VALID or INVALID: <reason>\n\nCode:\n${finalCode.slice(0, 3000)}`
    });
    if (!validation.text.includes('VALID')) throw new Error(`Generated skill invalid: ${validation.text}`);

    await fs.writeFile(filePath, finalCode);
    await fs.appendFile('./knowledge/soul.md',
      `\n## Skill Genesis ${new Date().toISOString()}\nCreated: ${name}.js\nTemplate: ${template}\nPurpose: ${purpose}\nTrigger: "${trigger}"\n`);
    await fs.appendFile('./knowledge/mikrotik-patterns.md',
      `\n## Auto-generated skill: ${name}\nTemplate: ${template}\nTriggered by: "${trigger}"\nPurpose: ${purpose}\nFile: ${filePath}\n`);

    return { success: true, skill: name, file: filePath, template, warning: 'Restart AgentOS to load new skill' };
  }
};

module.exports = { skill_create };
