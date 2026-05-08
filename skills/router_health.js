const fs = require('fs/promises'); const RouterOSAPI = require('node-routeros').RouterOSAPI;

const router_health = {
  name: "router_health",
  description: "Get live health for one or all routers: ping, CPU, memory, uptime, temperature",
  parameters: { type: "object", properties: { target: { type: "string", default: "all", description: "Router id, 'all', or 'role:core'" } }, required: [] },
  run: async ({ target = "all" }, { logger }) => {
    const inventory = JSON.parse(await fs.readFile('./knowledge/inventory.json', 'utf8'));
    let targets = [];
    if (target === 'all') targets = inventory;
    else if (target.startsWith('role:')) targets = inventory.filter(r => r.role === target.split(':')[1]);
    else targets = inventory.filter(r => r.id === target);

    const results = [];
    for (const router of targets) {
      try {
        const api = new RouterOSAPI({ host: router.host, user: router.user, password: router.password, timeout: 5 });
        await api.connect();
        const [res] = await api.write('/system/resource/print');
        const ping = await api.write('/ping', ['=address=1.1.1.1', '=count=1', '=interval=0.2']);
        const health = await api.write('/system/health/print').catch(() => [{}]);
        await api.close();

        results.push({
          id: router.id,
          name: router.name,
          host: router.host,
          online: true,
          cpu: parseInt(res['cpu-load'] || 0),
          memory: Math.round((parseInt(res['free-memory']) / parseInt(res['total-memory'])) * 100),
          uptime: res.uptime,
          ping: ping[0]?.['avg-rtt'] || ping[0]?.time || '0ms',
          temp: health[0]?.temperature || 'n/a'
        });
      } catch (e) {
        results.push({ id: router.id, name: router.name, host: router.host, online: false, cpu: 0, error: e.message });
      }
    }
    return { success: true, message: `Health: ${results.filter(r => r.online).length}/${targets.length} online`, results };
  }
};

module.exports = { router_health };
