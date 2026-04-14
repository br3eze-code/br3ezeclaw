const fs = require('fs/promises'); const RouterOSAPI = require('node-routeros').RouterOSAPI;
const onboard = {
  name: "onboard", description: "Onboard single router or shard config to fleet. Auto-generates Mission Control desktop app.",
  parameters: { type: "object", properties: { target: { type: "string", description: "Router id, 'all', or 'role:core'" }, admin_password: { type: "string" }, hotspot_name: { type: "string", default: "AgentOS-Hotspot" }, dns_servers: { type: "string", default: "1.1.1.1,8.8.8.8" }, gateway_url: { type: "string", description: "Your AgentOS gateway for Mission Control, e.g. http://10.0.1.100:3000" } }, required: ["target"] },
  run: async ({ target, admin_password, hotspot_name = "AgentOS-Hotspot", dns_servers = "1.1.1.1,8.8.8.8", gateway_url = "http://localhost:3000" }, { logger }) => {
    const inventory = JSON.parse(await fs.readFile('./knowledge/inventory.json', 'utf8')); let targets = [];
    if (target === 'all') targets = inventory; else if (target.startsWith('role:')) targets = inventory.filter(r => r.role === target.split(':')[1]);
    else { const router = inventory.find(r => r.id === target); if (!router) throw new Error(`Router id '${target}' not found`); targets = [router]; }
    if (targets.length === 0) throw new Error('No routers matched'); const results = [];
    for (const router of targets) {
      const cfg = { host: router.host, user: router.user, password: admin_password || router.password, wan_interface: router.wan_interface || 'ether1', lan_ip: router.lan_ip || '10.5.50.1/24', lan_bridge: 'bridge1', dhcp_pool: router.lan_ip.replace('1/24', '10-254/24') };
      if (!cfg.password) throw new Error(`No password for ${router.id}`); const api = new RouterOSAPI({ host: cfg.host, user: cfg.user, password: cfg.password, timeout: 15 });
      try {
        await api.connect(); await api.write('/system/backup/save', ['=name=agentos-pre-onboard']); await api.write('/system/identity/set', [`=name=AgentOS-${router.id}`]); await api.write('/user/set', ['=.id=admin', `=password=${cfg.password}`]);
        await api.write('/ip/dhcp-client/add', [`=interface=${cfg.wan_interface}`, '=disabled=no', '=comment=AgentOS: WAN']); await api.write('/interface/bridge/add', [`=name=${cfg.lan_bridge}`, '=comment=AgentOS: LAN']);
        const interfaces = await api.write('/interface/print'); for (const intf of interfaces) { if (intf.name.startsWith('ether') && intf.name!== cfg.wan_interface) { await api.write('/interface/bridge/port/add', [`=bridge=${cfg.lan_bridge}`, `=interface=${intf.name}`]); } }
        await api.write('/ip/address/add', [`=address=${cfg.lan_ip}`, `=interface=${cfg.lan_bridge}`, '=comment=AgentOS: LAN']); const poolName = `agentos-pool-${router.id}`; await api.write('/ip/pool/add', [`=name=${poolName}`, `=ranges=${cfg.dhcp_pool}`]);
        await api.write('/ip/dhcp-server/add', [`=name=agentos-dhcp-${router.id}`, `=interface=${cfg.lan_bridge}`, `=address-pool=${poolName}`, '=disabled=no']); const net = cfg.lan_ip.split('/')[0].split('.').slice(0,3).join('.') + '.0/24';
        await api.write('/ip/dhcp-server/network/add', [`=address=${net}`, `=gateway=${cfg.lan_ip.split('/')[0]}`, `=dns-server=${cfg.lan_ip.split('/')[0]}`]); await api.write('/ip/dns/set', [`=servers=${dns_servers}`, '=allow-remote-requests=yes']);
        const fw = [['/ip/firewall/filter/add', ['=chain=input', '=action=accept', '=connection-state=established,related']], ['/ip/firewall/filter/add', ['=chain=input', '=action=drop', `=in-interface=${cfg.wan_interface}`, '=connection-state=invalid']], ['/ip/firewall/filter/add', ['=chain=input', '=action=accept', '=protocol=icmp']], ['/ip/firewall/filter/add', ['=chain=input', '=action=accept', `=in-interface=${cfg.lan_bridge}`]], ['/ip/firewall/filter/add', ['=chain=input', '=action=drop', `=in-interface=${cfg.wan_interface}`]], ['/ip/firewall/nat/add', ['=chain=srcnat', `=out-interface=${cfg.wan_interface}`, '=action=masquerade']]];
        for (const [cmd, args] of fw) await api.write(cmd, args); const hsProfile = `${hotspot_name}-${router.id}`; await api.write('/ip/hotspot/profile/add', [`=name=${hsProfile}`, `=hotspot-address=${cfg.lan_ip.split('/')[0]}`, `=dns-name=${router.id}.hotspot.local`, '=html-directory=hotspot']);
        await api.write('/ip/hotspot/add', [`=name=${hsProfile}`, `=interface=${cfg.lan_bridge}`, `=profile=${hsProfile}`, '=disabled=no']); await api.write('/system/backup/save', ['=name=agentos-post-onboard']); await api.close();
        await fs.appendFile('./knowledge/network-topology.md', `\n## Router: ${router.name} (${router.id})\n- **IP**: ${router.host}\n- **LAN**: ${cfg.lan_ip}\n- **Role**: ${router.role}\n- **Onboarded**: ${new Date().toISOString()}\n`);
        results.push({ id: router.id, name: router.name, success: true });
      } catch (err) { try { await api.close(); } catch {} await fs.appendFile('./knowledge/failed-commands.md', `\n## Onboard failed ${new Date().toISOString()}\nRouter: ${router.id}\nError: ${err.message}\n`); results.push({ id: router.id, name: router.name, success: false, error: err.message }); }
      await new Promise(r => setTimeout(r, 1000));
    }
    const ok = results.filter(r => r.success).length;

    // === GENERATE MISSION CONTROL DESKTOP APP ===
    const token = process.env.AGENTOS_TOKEN || 'YOUR_TOKEN_HERE';
    const missionHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AgentOS Mission Control</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--bg:#0f172a;--card:#1e293b;--accent:#3b82f6;--ok:#22c55e;--bad:#ef4444}*{box-sizing:border-box}body{margin:0;font-family:system-ui;background:var(--bg);color:#fff}header{background:var(--card);padding:16px 20px;border-bottom:1px solid #334155;display:flex;justify-content:space-between;align-items:center}h1{margin:0;font-size:18px}main{padding:20px;max-width:1200px;margin:0 auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}.card{background:var(--card);border-radius:12px;padding:16px;border:1px solid #334155}.card h3{margin:0 0 12px;font-size:14px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px}button{width:100%;padding:12px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;margin:6px 0;transition:.2s}button:hover{opacity:.9}button.secondary{background:#475569}button.danger{background:var(--bad)}button.success{background:var(--ok)}input{width:100%;padding:10px;background:#0f172a;border:1px solid #334155;color:#fff;border-radius:6px;margin:6px 0}.status{font-size:12px;color:#94a3b8;margin-top:8px;padding:8px;background:#0f172a;border-radius:6px;max-height:200px;overflow:auto}.fleet{display:flex;flex-direction:column;gap:8px}.router{display:flex;justify-content:space-between;align-items:center;padding:10px;background:#0f172a;border-radius:6px;font-size:13px}.dot{width:8px;height:8px;border-radius:50%;background:var(--ok);margin-right:8px}.dot.off{background:var(--bad)}</style></head><body><header><h1>🚀 AgentOS Mission Control</h1><div style="font-size:12px;color:#94a3b8">${new Date().toLocaleDateString()}</div></header><main><div class="grid"><div class="card"><h3>Gateway</h3><input id="gw" value="${gateway_url}" placeholder="http://10.0.1.100:3000"><input id="tk" type="password" value="${token}" placeholder="API Token"><button onclick="save()">💾 Save Config</button><div class="status" id="cfg-status">Ready</div></div><div class="card"><h3>Fleet Actions</h3><button class="success" onclick="run('onboard','all')">🚀 Onboard All</button><button onclick="run('hotspot-brand','all')">🎨 Brand Hotspots</button><button class="secondary" onclick="run('memory')">🧠 Memory Dump</button><button class="danger" onclick="run('freeze','unfreeze')">🔓 Unfreeze Agent</button></div><div class="card"><h3>Quick Tools</h3><button onclick="uiRecord()">🔴 UI Recorder</button><button onclick="uiAgent()">🖱️ Run UI Agent</button><button class="secondary" onclick="window.open(document.getElementById('gw').value+'/api/memory?token='+document.getElementById('tk').value)">📊 Open Logs</button></div><div class="card" style="grid-column:1/-1"><h3>Fleet Status (${targets.length} routers)</h3><div class="fleet" id="fleet">${targets.map(r=>`<div class="router"><div style="display:flex;align-items:center"><span class="dot"></span>${r.name}</div><div style="color:#94a3b8">${r.host}</div></div>`).join('')}</div></div><div class="card" style="grid-column:1/-1"><h3>Activity Log</h3><div class="status" id="log">Mission Control ready. Last onboard: ${ok}/${targets.length} routers.</div></div></div></main><script>function save(){localStorage.setItem('agw',gw.value);localStorage.setItem('atk',tk.value);cfgStatus('✅ Saved');}function cfgStatus(m){document.getElementById('cfg-status').textContent=m}function log(m){const l=document.getElementById('log');l.innerHTML=new Date().toLocaleTimeString()+' → '+m+'<br>'+l.innerHTML}async function run(skill,target){const g=localStorage.getItem('agw')||gw.value;const t=localStorage.getItem('atk')||tk.value;if(!g||!t)return alert('Set gateway + token');log('Running '+skill+'...');try{const u=new URL(g+'/api/'+skill);u.searchParams.set('token',t);if(target)u.searchParams.set('target',target);const r=await fetch(u);const d=await r.json();log('✅ '+(d.message||'Done').slice(0,80));}catch(e){log('❌ '+e.message)}}function uiRecord(){const url=prompt('URL to record:','https://');if(url)run('ui-record');}function uiAgent(){const url=prompt('Target URL:');const act=prompt('Actions JSON:','[]');if(url&&act){const g=localStorage.getItem('agw')||gw.value;window.open(g+'/api/ui-agent?url='+encodeURIComponent(url)+'&actions='+encodeURIComponent(act)+'&token='+(localStorage.getItem('atk')||tk.value))}}window.onload=()=>{gw.value=localStorage.getItem('agw')||gw.value;tk.value=localStorage.getItem('atk')||tk.value;}</script></body></html>`;

    const batInstaller = `@echo off
echo Installing AgentOS Mission Control...
copy "AgentOS-Mission-Control.html" "%USERPROFILE%\\Desktop\\" >nul
echo [InternetShortcut] > "%USERPROFILE%\\Desktop\\AgentOS Mission Control.url"
echo URL=file:///%USERPROFILE%/Desktop/AgentOS-Mission-Control.html >> "%USERPROFILE%\\Desktop\\AgentOS Mission Control.url"
echo IconFile=%SystemRoot%\\system32\\SHELL32.dll >> "%USERPROFILE%\\Desktop\\AgentOS Mission Control.url"
echo IconIndex=13 >> "%USERPROFILE%\\Desktop\\AgentOS Mission Control.url"
echo ✅ Installed to Desktop. Double-click "AgentOS Mission Control" to launch.
pause`;

    const shInstaller = `#!/bin/bash
echo "Installing AgentOS Mission Control..."
cp "AgentOS-Mission-Control.html" ~/Desktop/
chmod +x ~/Desktop/AgentOS-Mission-Control.html
echo "✅ Installed to Desktop. Double-click to launch."`;

    await fs.mkdir('/mnt/data', { recursive: true });
    await fs.writeFile('/mnt/data/AgentOS-Mission-Control.html', missionHtml);
    await fs.writeFile('/mnt/data/Install-Windows.bat', batInstaller);
    await fs.writeFile('/mnt/data/Install-Mac-Linux.sh', shInstaller);

    let msg = `🚀 *Shard Onboard Complete*\n\n**Success**: ${ok}/${targets.length}\n\n`; results.forEach(r => { msg += r.success? `✅ ${r.name}\n` : `❌ ${r.name}: ${r.error}\n`; });
    msg += `\n🎯 *Mission Control Generated*\n\n1. Download: \`AgentOS-Mission-Control.html\`\n2. Download: \`Install-Windows.bat\` (or.sh for Mac/Linux)\n3. Run installer → Desktop shortcut created\n4. Double-click for full fleet control\n\nGateway pre-configured: ${gateway_url}`;

    await fs.appendFile('./knowledge/soul.md', `\n## Shard Onboard ${new Date().toISOString()}\nTarget: ${target}\nSuccess: ${ok}/${targets.length}\nMission Control generated\n`);
    return { success: ok > 0, message: msg, results, mission_control: '/mnt/data/AgentOS-Mission-Control.html' };
  }
}; module.exports = { onboard };
