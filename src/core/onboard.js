/**
 * AgentOS Onboarding Service
 * Consolidates routing script generation, agent provisioning, and system setup.
 */

const fs = require('fs/promises');
const path = require('path');
const { getManager } = require('./mikrotik');
const { logger } = require('./logger');
const createDebug = require('debug');


// Namespaced debuggers — enable with: DEBUG=agentos:* or DEBUG=agentos:onboard
const debug = createDebug('agentos:onboard');
const debugTemplate = createDebug('agentos:onboard:template');
const debugFleet = createDebug('agentos:onboard:fleet');

/**
 * Templates an RSC script by replacing {{VAR}} placeholders with values from process.env
 * This allows using .env variables in any .rsc file without manual writing.
 */
function templateRsc(content, extra = {}) {
    const vars = {
        ...process.env,
        TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN,
        WHATSAPP_ENABLED: extra.whatsappEnabled !== undefined ? String(extra.whatsappEnabled) : process.env.WHATSAPP_ENABLED,
        WHATSAPP_AUTH_DIR: extra.whatsappAuthDir || process.env.WHATSAPP_AUTH_DIR,
        ...extra
    };

    return content.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, p1) => {
        const val = vars[p1];
        if (val !== undefined) return val;

        // Fallback for some common names
        if (p1 === 'AGENTOS_IP' && vars.AGENTOS_NODE_URL) {
            try {
                const url = new URL(vars.AGENTOS_NODE_URL);
                return url.hostname;
            } catch (e) {
                return vars.AGENTOS_NODE_URL;
            }
        }

        return match;
    });
}

/**
 * Generates the core AgentOS setup script for MikroTik.
 * Tries to read setup.rsc as a template, otherwise falls back to hardcoded default.
 */
function generateSetupScript(config = {}) {
    const AGENTOS_NODE_URL = config.AGENTOS_NODE_URL || process.env.AGENTOS_NODE_URL || 'http://localhost:3000';
    const TELEGRAM_BOT_TOKEN = config.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN || '';
    const TELEGRAM_CHAT_ID = config.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || (process.env.ALLOWED_CHAT_IDS ? process.env.ALLOWED_CHAT_IDS.split(',')[0] : '');

    const AGENTOS_IP = new URL(AGENTOS_NODE_URL).hostname;

    // Use the logic from the refactored root onboard.js
    // I will use a cleaner template approach here.

    return `/interface bridge
add name=bridge1
/system identity set name="AgentOS-PowerConnect"
/system ntp client set enabled=yes
/system ntp client servers add address=pool.ntp.org
/system ntp client servers add address=time.cloudflare.com
/system watchdog set enabled=yes watch-address=1.1.1.1 watchdog-timer=5m
/ip service set telnet disabled=yes
/ip service set ftp disabled=yes
/ip service set ssh port=2222 disabled=no
/ip service set api-ssl disabled=no
/interface ethernet
set [ find default-name=ether1 ] advertise=10M-half,10M-full,100M-half,100M-full,5000M-full
/interface list
add name=WAN
add name=LAN
/interface wireless security-profiles
set [ find default=yes ] supplicant-identity=MikroTik
add name=open-hotspot supplicant-identity=MikroTik
/interface wireless
set [ find default-name=wlan1 ] band=2ghz-b/g/n disabled=no frequency=2462 mode=ap-bridge security-profile=open-hotspot ssid="Br3eze Africa"
/ip hotspot profile
set [ find default=yes ] dns-name=hotspot.local
add dns-name=captive.local hotspot-address=192.168.88.1 login-by=http-chap,http-pap,trial,mac,cookie name=enforce-portal trial-uptime-limit=5m
/ip hotspot user profile
set [ find default=yes ] on-login="\\
    \\n\\
    \\n:local userNow  \\$user\\
    \\n:local schName  (\\"exp-\\" . \\$userNow)\\
    \\n\\
    \\n:local pName [/ip hotspot user get [find name=\\$userNow] profile]\\
    \\n\\
    \\n# Notify the AgentOS Node server that a login occurred\\
    \\n/tool fetch url=\\"${AGENTOS_NODE_URL}/api/event/login\\?user=\\$userNow&profile=\\$pName\\" keep-result=no\\
    \\n\\
    \\n:local BOT_TOKEN \\"${TELEGRAM_BOT_TOKEN}\\"\\
    \\n:local CHAT_ID   \\"${TELEGRAM_CHAT_ID}\\"\\
    \\n\\
    \\n:if ([:len \\$userNow] = 0) do={\\
    \\n    :log warning \\"Hotspot: Login fired with empty user.\\"\\
    \\n    :error \\"Aborted: Empty user\\"\\
    \\n}\\
    \\n\\
    \\n:local userId   [/ip hotspot user   find where name=\\$userNow]\\
    \\n:local activeId [/ip hotspot active find where user=\\$userNow]\\
    \\n\\
    \\n:if ([:len \\$userId] = 0) do={\\
    \\n    :error (\\"Aborted: No user record \\\\E2\\\\80\\\\94 \\" . \\$userNow)\\
    \\n}\\
    \\n\\
    \\n:local pName     [/ip hotspot user get \\$userId profile]\\
    \\n:local days      0\\
    \\n:local dataBytes 0\\
    \\n\\
    \\n:if (\\$pName = \\"1Day\\")  do={\\
    \\n    :set days      1\\
    \\n    :set dataBytes 1073741824\\
    \\n}\\
    \\n:if (\\$pName = \\"7Day\\")  do={\\
    \\n    :set days      7\\
    \\n    :set dataBytes 7516192768\\
    \\n}\\
    \\n:if (\\$pName = \\"30Day\\") do={\\
    \\n    :set days      30\\
    \\n    :set dataBytes 32212254720\\
    \\n}\\
    \\n\\
    \\n:if (\\$days = 0) do={\\
    \\n    :log error (\\"Hotspot: Unknown profile \\\\\\\\\\"\\" . \\$pName . \\"\\\\\\\\\\" for \\" . \\$userNow)\\
    \\n    :if ([:len \\$activeId] > 0) do={ /ip hotspot active remove \\$activeId }\\
    \\n    :error (\\"Unknown profile: \\" . \\$pName)\\
    \\n}\\
    \\n\\
    \\n:if ([:len \\$activeId] > 0) do={\\
    \\n    :do {\\
    \\n        :local macAddr [/ip hotspot active get \\$activeId mac-address]\\
    \\n        /ip hotspot user set \\$userId mac-address=\\$macAddr disabled=no\\
    \\n        :log info (\\"Hotspot: MAC locked \\\\E2\\\\80\\\\94 \\" . \\$userNow . \\" -> \\" . \\$macAddr)\\
    \\n    } on-error={\\
    \\n        :log warning (\\"Hotspot: MAC lock skipped \\\\E2\\\\80\\\\94 session unstable for \\" . \\$userNow)\\
    \\n    }\\
    \\n}\\
    \\n\\
    \\n:local nowDate [/system clock get date]\\
    \\n:local nowTime [/system clock get time]\\
    \\n:local nowSecs [:totime (\\$nowDate . \\" \\" . \\$nowTime)]\\
    \\n\\
    \\n# Calculate expiry based on duration mapping\\
    \\n:local expSecs (\\$nowSecs + (\\$days * 86400))\\
    \\n:local expDate [:pick [:tostring \\$expSecs] 0 11]\\
    \\n:local expTime [:pick [:tostring \\$expSecs] 12 20]\\
    \\n\\
    \\n# Schedule the removal of the user after expiry\\
    \\n/system scheduler add name=\\$schName start-date=\\$expDate start-time=\\$expTime interval=0s on-event=\\"/ip hotspot user remove [find name=\\$userNow]; /system scheduler remove \\$schName\\"\\
    \\n\\
    \\n# Set data limits if applicable\\
    \\n:if (\\$dataBytes > 0) do={\\
    \\n    /ip hotspot user set \\$userId limit-bytes-total=\\$dataBytes\\
    \\n}\\
    \\n\\
    \\n# Optional: Send Telegram notification on successful login\\
    \\n/tool fetch url=\\"https://api.telegram.org/bot\\$BOT_TOKEN/sendMessage\\\\?chat_id=\\$CHAT_ID&text=User+\\$userNow+logged+in+on+profile+\\$pName+expiring+on+\\$expDate\\" keep-result=no\\
"
/ip hotspot user profile
add name=1Day shared-users=1
add name=7Day shared-users=1
add name=30Day shared-users=1
/ip hotspot user
add name=admin password=admin profile=default
/ip firewall nat
add action=masquerade chain=srcnat out-interface=ether1
/ip firewall filter
add action=accept chain=input protocol=icmp
add action=accept chain=input connection-state=established,related
add action=drop chain=input in-interface=ether1
/ip dns
set allow-remote-requests=yes servers=8.8.8.8,1.1.1.1
/ip dhcp-server network
add address=192.168.88.0/24 dns-server=192.168.88.1 gateway=192.168.88.1
/ip pool
add name=hs-pool-1 ranges=192.168.88.10-192.168.88.250
/ip dhcp-server
add address-pool=hs-pool-1 disabled=no interface=bridge1 name=dhcp1
/ip address
add address=192.168.88.1/24 interface=bridge1 network=192.168.88.0
/ip hotspot
add address-pool=hs-pool-1 disabled=no interface=bridge1 name=hotspot1 profile=enforce-portal
/ip hotspot walled-garden
add dst-host=*.agentos.space
add dst-host=*.firebaseio.com
add dst-host=*.firebaseapp.com
add dst-host=cdnjs.cloudflare.com
add dst-host=*.telegram.org
add dst-host=*.t.me
add dst-host=api.telegram.org
add dst-host=*.slack.com
add dst-host=*.slack-edge.com
add dst-host=slack.com
add dst-host=*.discord.com
add dst-host=*.discord.gg
add dst-host=*.discordapp.com
add dst-host=*.whatsapp.net
add dst-host=*.whatsapp.com
add dst-host=*.wa.me
/ip service
set www-ssl disabled=no
set api address=${AGENTOS_IP}/32
/system clock
set time-zone-name=Africa/Harare
/system identity
set name=AgentOS
`;
}

/**
 * Loads a template from file and applies templating
 */
async function loadTemplate(name, options) {
    try {
        const filePath = path.join(process.cwd(), name);
        const content = await fs.readFile(filePath, 'utf8');
        return templateRsc(content, options);
    } catch (e) {
        if (name === 'setup.rsc') {
            logger.warn('setup.rsc not found, using default fallback.');
            return templateRsc(generateSetupScript(options), options);
        }
        logger.warn(`Optional template ${name} not found: ${e.message}`);
        return null;
    }
}

/**
 * Connects to a router and applies all onboarding scripts.
 */
async function onboardRouter(options = {}) {
    const manager = getManager(options);
    const host = options.host || 'default router';
    debug('onboardRouter: host=%s options=%O', host, options);
    logger.info(`--- Starting Onboard for ${host} ---`);

    try {
        const isConnected = await manager.connect();
        if (!isConnected) {
            throw new Error("Failed to connect to MikroTik. Check configuration.");
        }

        // 1. Prepare scripts in order
        const scriptsToRun = [
            { name: 'setup.rsc', priority: 1 },
            { name: 'mikro.rsc', priority: 2 },
            { name: 'agentos-sentinel.rsc', priority: 3 }
        ];

        for (const scriptInfo of scriptsToRun) {
            const scriptContent = await loadTemplate(scriptInfo.name, options);
            if (!scriptContent) continue;

            const tempName = `agentos_${scriptInfo.name.replace(/\./g, '_')}`;

            // Cleanup existing temp script
            try {
                const scripts = await manager.state.conn.menu('/system/script').get();
                const existing = scripts.filter(s => s.name === tempName);
                if (existing.length > 0) {
                    await manager.state.conn.menu('/system/script').remove(manager._getId(existing[0]));
                }
            } catch (e) { }

            logger.info(`Applying ${scriptInfo.name}...`);

            // Upload
            await manager.state.conn.write([
                '/system/script/add',
                `=name=${tempName}`,
                `=source=${scriptContent}`
            ]);

            if (options.dryRun) {
                logger.info(`DRY RUN: ${scriptInfo.name} uploaded as ${tempName}`);
            } else {
                // Execute
                try {
                    // We use write directly because run() might drop connection
                    await manager.state.conn.write([
                        '/system/script/run',
                        `=number=${tempName}`
                    ]);

                    // Small delay to allow execution start
                    await new Promise(r => setTimeout(r, 2000));

                    // If connection didn't drop, cleanup
                    if (manager.isConnected) {
                        const scripts = await manager.state.conn.menu('/system/script').get();
                        const created = scripts.filter(s => s.name === tempName);
                        if (created.length > 0) {
                            await manager.state.conn.menu('/system/script').remove(manager._getId(created[0]));
                        }
                    }
                } catch (e) {
                    logger.warn(`Connection dropped or script ${scriptInfo.name} caused a reboot (expected).`);
                    // Wait for reboot and reconnect for next stage
                    await new Promise(r => setTimeout(r, 12000));
                    try {
                        const reconnected = await manager.connect();
                        if (reconnected && manager.isConnected) {
                            // Try to cleanup the temp script now that we are back
                            try {
                                const scripts = await manager.state.conn.menu('/system/script').get();
                                const created = scripts.filter(s => s.name === tempName);
                                if (created.length > 0) {
                                    await manager.state.conn.menu('/system/script').remove(manager._getId(created[0]));
                                }
                            } catch (cleanupErr) {
                                logger.debug(`Post-reboot cleanup of ${tempName} failed (expected if ephemeral): ${cleanupErr.message}`);
                            }
                        }
                    } catch (reconnectError) {
                        logger.error(`Failed to reconnect after stage ${scriptInfo.name}: ${reconnectError.message}`);
                    }
                }
            }
        }

        // 2. Post-script configuration (Identity, Backup)
        if (!options.dryRun) {
            try {
                // Ensure we are connected for post-onboard steps
                if (!manager.isConnected) {
                    logger.info('Reconnecting for post-onboard finalization...');
                    await manager.connect();
                }

                if (!manager.isConnected) {
                    throw new Error('Failed to establish connection for finalization steps');
                }

                const identity = options.name ? `AgentOS-${options.name}` : `AgentOS-${options.id || 'Node'}`;
                logger.info(`Setting system identity to ${identity}...`);
                await manager.state.conn.write([
                    '/system/identity/set',
                    `=name=${identity}`
                ]);

                logger.info('Saving post-onboard backup...');
                await manager.state.conn.write([
                    '/system/backup/save',
                    '=name=agentos-post-onboard'
                ]);
            } catch (e) {
                logger.warn(`Post-onboard steps failed (minor): ${e.message}`);
            }
        }

        return { success: true, message: "Onboarded all components successfully" };
    } catch (error) {
        logger.error(`Onboard failed: ${error.message}`);
        return { success: false, error: error.message };
    } finally {
        manager.disconnect();
    }
}

/**
 * Provisions agents for the onboarded router.
 */
async function provisionAgents(routerId, options = {}) {
    // Lazy load create_agent
    let create_agent;
    try {
        create_agent = require('../../skills/create_agent').create_agent;
    } catch (e) {
        // Fallback for different pathing or direct require
        create_agent = require('../../skills/create_agent');
    }

    logger.info(`Provisioning agent for router ${routerId}...`);

    try {
        const result = await create_agent.run({
            name: `router-${routerId}`,
            purpose: `Autonomous operator for router ${options.name || routerId} at ${options.host || 'unknown'}`,
            persona: "Precise MikroTik engineer, cautious with changes",
            triggers: "manual,schedule,alert",
            allowed_skills: "router_health,create_user,hotspot_brand,rollback,memory",
            roles: "network-operator,security-auditor,config-manager",
            duties: "monitor health,provision users,backup configs,manage hotspot,respond to alerts",
            tools: "routeros-api,ssh,winbox,ping,snmp,gateway-api",
            memory_namespace: routerId,
            auto_run: false
        }, { logger });

        if (result.success) {
            await updateSoul(`Agent router-${routerId} provisioned for ${options.host}`);
        }
        return result;
    } catch (error) {
        logger.error(`Agent provisioning failed: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * Provisions the Fleet Master agent to orchestrate all other agents.
 */
async function createFleetMasterAgent() {
    let create_agent;
    try {
        create_agent = require('../../skills/create_agent').create_agent;
    } catch (e) {
        create_agent = require('../../skills/create_agent');
    }

    logger.info("Provisioning Fleet Master agent...");

    try {
        const result = await create_agent.run({
            name: "fleet-master",
            purpose: "Orchestrate entire AgentOS fleet and manage global policies",
            persona: "Fleet commander, strategic and systematic, focused on system-wide integrity",
            triggers: "manual,schedule",
            allowed_skills: "router_health,onboard,create_user,create_agent,hotspot_brand,memory",
            roles: "orchestrator,admin,architect",
            duties: "fleet onboarding,agent spawning,health aggregation,policy enforcement,skill distribution",
            tools: "gateway-api,inventory-manager,agents-registry,mission-control",
            memory_namespace: "fleet",
            auto_run: false
        }, { logger });

        if (result.success) {
            await updateSoul("Fleet Master agent provisioned for orchestration");
        }
        return result;
    } catch (error) {
        logger.error(`Fleet Master provisioning failed: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * Bulk onboard multiple routers from inventory
 */
async function onboardFleet(target, options = {}) {
    let inventory = [];
    try {
        const inventoryPath = path.join(process.cwd(), 'knowledge', 'inventory.json');
        inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
    } catch (e) {
        logger.error(`Failed to load inventory: ${e.message}`);
        return { success: false, error: "Inventory not found" };
    }

    let targets = [];
    if (target === 'all') {
        targets = inventory;
    } else if (target.startsWith('role:')) {
        const role = target.split(':')[1];
        targets = inventory.filter(r => r.role === role);
    } else {
        targets = inventory.filter(r => r.id === target || r.name === target);
    }

    if (targets.length === 0) {
        return { success: false, error: `No routers matched target: ${target}` };
    }

    debugFleet('onboardFleet: target=%s count=%d', target, targets.length);
    logger.info(`--- Starting Fleet Onboard [Target: ${target}, Count: ${targets.length}] ---`);
    const results = [];

    for (const router of targets) {
        const routerOptions = {
            ...options,
            name: router.name,
            host: router.host,
            user: router.user || options.user,
            password: router.password || options.password,
            port: router.port || options.port || 8728
        };

        const result = await onboardRouter(routerOptions);
        results.push({ id: router.id, name: router.name, success: result.success, error: result.error });
        
        if (result.success) {
            await updateSoul(`Onboarded ${router.id} (${router.name}) at ${router.host}`);
            if (!options.skipProvision) {
                await provisionAgents(router.id, routerOptions);
            }
        }
    }

    const successCount = results.filter(r => r.success).length;
    if (successCount > 0) {
        if (!options.skipProvision) {
            const masterResult = await createFleetMasterAgent();
            results.push({ 
                id: 'fleet-master', 
                name: 'Fleet Master Agent', 
                success: masterResult.success, 
                error: masterResult.error,
                isAgent: true 
            });
        }
        await generateMissionControl(results);
    }

    return { 
        success: successCount > 0, 
        total: targets.length, 
        succeeded: successCount, 
        results 
    };
}

/**
 * Updates the system 'soul' file with history.
 */
async function updateSoul(entry) {
    try {
        const soulPath = path.join(process.cwd(), 'knowledge', 'soul.md');
        const content = `\n## [${new Date().toISOString()}] ${entry}\n`;
        await fs.appendFile(soulPath, content);
    } catch (e) {
        logger.warn(`Could not update soul: ${e.message}`);
    }
}

/**
 * Generates a Mission Control dashboard HTML file.
 */
async function generateMissionControl(results) {
    try {
        const ok = results.filter(r => r.success).length;
        const agents = results.filter(r => r.success).map(r => `router-${r.id}`).join(', ');
        
        const missionHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>AgentOS Mission Control</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0f172a;
            --card-bg: rgba(30, 41, 59, 0.7);
            --border: rgba(255, 255, 255, 0.1);
            --accent: #3b82f6;
            --accent-glow: rgba(59, 130, 246, 0.5);
            --success: #10b981;
            --fail: #ef4444;
            --text-main: #f8fafc;
            --text-dim: #94a3b8;
        }
        * { box-sizing: border-box; }
        body { 
            margin: 0; 
            background: var(--bg); 
            color: var(--text-main); 
            font-family: 'Outfit', system-ui, sans-serif;
            background-image: 
                radial-gradient(at 0% 0%, rgba(59, 130, 246, 0.15) 0px, transparent 50%),
                radial-gradient(at 100% 100%, rgba(139, 92, 246, 0.15) 0px, transparent 50%);
            min-height: 100vh;
        }
        header { 
            background: rgba(15, 23, 42, 0.8);
            backdrop-filter: blur(12px);
            padding: 24px 40px; 
            border-bottom: 1px solid var(--border);
            position: sticky;
            top: 0;
            z-index: 100;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .logo { font-size: 24px; font-weight: 700; background: linear-gradient(to right, #3b82f6, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; display: flex; align-items: center; gap: 12px; }
        main { padding: 40px; max-width: 1400px; margin: auto; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 32px; }
        .card { 
            background: var(--card-bg); 
            backdrop-filter: blur(8px);
            padding: 32px; 
            border-radius: 24px; 
            border: 1px solid var(--border); 
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
            transition: transform 0.2s ease, border-color 0.2s ease;
        }
        .card:hover { transform: translateY(-4px); border-color: var(--accent); }
        .status-ok { color: var(--success); }
        .status-fail { color: var(--fail); }
        h3 { margin-top: 0; color: var(--text-dim); font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600; }
        .big-number { font-size: 64px; font-weight: 700; margin: 16px 0; letter-spacing: -0.02em; }
        .badge { display: inline-block; padding: 4px 12px; border-radius: 99px; background: rgba(59, 130, 246, 0.2); color: var(--accent); font-size: 12px; font-weight: 600; }
        .log-container { 
            background: rgba(0, 0, 0, 0.2); 
            padding: 20px; 
            border-radius: 16px; 
            font-family: 'Fira Code', monospace; 
            font-size: 13px; 
            color: #cbd5e1;
            max-height: 400px;
            overflow-y: auto;
            border: 1px solid var(--border);
        }
        .log-entry { margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.03); display: flex; gap: 12px; }
        .log-tag { min-width: 60px; font-weight: bold; }
        .tag-ok { color: var(--success); }
        .tag-fail { color: var(--fail); }
        @keyframes pulse { 0% { box-shadow: 0 0 0 0 var(--accent-glow); } 70% { box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); } 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); } }
        .active-pulse { width: 12px; height: 12px; background: var(--success); border-radius: 50%; animation: pulse 2s infinite; }
    </style>
</head>
<body>
    <header>
        <div class="logo">🚀 AgentOS Mission Control</div>
        <div style="display: flex; align-items: center; gap: 8px;">
            <div class="active-pulse"></div>
            <span style="font-size: 14px; font-weight: 500; color: var(--text-dim);">Fleet Online</span>
        </div>
    </header>
    <main>
        <div class="grid">
            <div class="card">
                <h3>Fleet Integrity</h3>
                <div class="big-number">${ok}<span style="font-size: 24px; color: var(--text-dim); font-weight: 400;">/${results.length}</span></div>
                <p style="color: var(--text-dim); line-height: 1.6;">Nodes successfully synchronized and autonomous agents provisioned across the edge fleet.</p>
            </div>
            <div class="card">
                <h3>Autonomous Agents</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px;">
                    ${results.filter(r => r.success).map(r => `<span class="badge">router-${r.id}</span>`).join('')}
                    <span class="badge" style="background: rgba(139, 92, 246, 0.2); color: #a78bfa;">fleet-master</span>
                </div>
                <p style="color: var(--text-dim); margin-top: 24px; line-height: 1.6;">Each node is managed by a dedicated agent with specific roles and duties.</p>
            </div>
            <div class="card">
                <h3>Messaging Channels</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px;">
                    ${[
                        process.env.TELEGRAM_TOKEN && 'Telegram',
                        process.env.WHATSAPP_ENABLED === 'true' && 'WhatsApp',
                        process.env.SLACK_BOT_TOKEN && 'Slack',
                        process.env.DISCORD_BOT_TOKEN && 'Discord',
                        process.env.SMS_ENABLED === 'true' && 'SMS',
                        process.env.USSD_ENABLED === 'true' && 'USSD',
                        process.env.EMAIL_ENABLED === 'true' && 'Email'
                    ].filter(Boolean).map(c => `<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #10b981;">${c}</span>`).join('') || '<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #ef4444;">None</span>'}
                </div>
                <p style="color: var(--text-dim); margin-top: 24px; line-height: 1.6;">Connected messaging interfaces for real-time control and alerts.</p>
            </div>
        </div>
        <div class="card" style="margin-top: 32px;">
            <h3>Deployment Protocol Logs</h3>
            <div class="log-container">
                ${results.map(r => `
                    <div class="log-entry">
                        <span class="log-tag ${r.success ? 'tag-ok' : 'tag-fail'}">[${r.success ? 'SUCCESS' : 'FAILURE'}]</span>
                        <span style="color: var(--text-main); font-weight: 600;">${r.id}</span>
                        <span style="color: var(--text-dim);">${r.name}</span>
                        ${r.error ? `<span style="color: var(--fail); margin-left: auto;">${r.error}</span>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    </main>
</body>
</html>`;

        const dataPath = path.join(process.cwd(), 'data');
        await fs.mkdir(dataPath, { recursive: true });
        await fs.writeFile(path.join(dataPath, 'AgentOS-Mission-Control.html'), missionHtml);
        logger.info(`Generated Premium Mission Control at /data/AgentOS-Mission-Control.html`);
    } catch (e) {
        logger.error(`Failed to generate Mission Control: ${e.message}`);
    }
}

/**
 * Interactive onboarding wizard — @clack/prompts + picocolors.
 * Supports back navigation via a step-loop pattern.
 *
 * Steps: 1.Router  2.NodeURL  3.Telegram  4.WhatsApp  5.Slack  6.Discord  7.Skills/Debug  8.Confirm
 */
async function runWizard() {
    const pc = require('picocolors');
    const {
        intro, outro, text, password: clackPwd, select, confirm,
        spinner, cancel, isCancel, note,
    } = await import('@clack/prompts');

    // Sentinel symbols for back / cancel navigation
    const BACK   = Symbol('BACK');
    const CANCEL = Symbol('CANCEL');

    async function ask(promptFn) {
        const r = await promptFn();
        return isCancel(r) ? CANCEL : r;
    }

    async function navBar(label, stepIdx) {
        if (stepIdx === 0) return 'continue';
        const r = await select({
            message: pc.dim(`[${label}]`),
            options: [
                { value: 'continue', label: pc.green('▶  Continue') },
                { value: 'back',     label: pc.yellow('←  Back')     },
                { value: 'cancel',   label: pc.red('✗  Cancel')    },
            ],
        });
        return isCancel(r) ? 'cancel' : r;
    }

    const S = {
        host: '192.168.88.1', user: 'agentos-api', pass: '', port: '8728',
        nodeUrl: 'http://localhost:3000',
        telegramEnabled: false, telegramToken: '', allowedIds: '',
        whatsappEnabled: false, whatsappAuthDir: './auth_info_baileys', whatsappDebug: false,
        slackEnabled: false,   slackBotToken: '', slackChannel: '',
        discordEnabled: false, discordBotToken: '', discordChannelId: '',
        smsEnabled: false,  smsProvider: 'twilio',
        twilioSid: '', twilioToken: '', twilioFrom: '',
        econetClientId: '', econetClientSecret: '', econetFromName: 'AgentOS', econetBaseUrl: 'https://api.econet.co.zw',
        ussdEnabled: false, atApiKey: '', atUsername: '', ussdServiceCode: '',
        emailEnabled: false, smtpHost: '', smtpPort: '587', smtpUser: '', smtpPass: '', smtpFrom: '',
        logLevel: 'info', skillsDebug: false,
        dryRun: false,
    };

    intro(pc.bgCyan(pc.black(' AgentOS Setup Wizard ')) + '  ' + pc.dim('Use ← Back at any step'));

    const STEPS = [

        // 1 · Router
        async () => {
            const h = await ask(() => text({ message: pc.cyan('1/7') + '  MikroTik IP / hostname', placeholder: '192.168.88.1', initialValue: S.host, validate: v => v.trim() ? undefined : 'Required' }));
            if (h === CANCEL) return CANCEL; S.host = h;
            const u = await ask(() => text({ message: pc.cyan('1/7') + '  API username', placeholder: 'agentos-api', initialValue: S.user }));
            if (u === CANCEL) return CANCEL; S.user = u;
            const p = await ask(() => clackPwd({ message: pc.cyan('1/7') + '  API password', validate: v => v.length >= 4 ? undefined : 'Min 4 chars' }));
            if (p === CANCEL) return CANCEL; S.pass = p;
            const pt = await ask(() => text({ message: pc.cyan('1/7') + '  API port', placeholder: '8728', initialValue: S.port }));
            if (pt === CANCEL) return CANCEL; S.port = pt || '8728';
            return true;
        },

        // 2 · AgentOS Node URL
        async (i) => {
            const nav = await navBar('2/7  Node URL', i);
            if (nav === 'cancel') return CANCEL;
            if (nav === 'back')   return BACK;
            const u = await ask(() => text({ message: pc.cyan('2/7') + '  AgentOS Node URL', placeholder: 'http://your-server:3000', initialValue: S.nodeUrl, validate: v => { try { new URL(v.trim()); return undefined; } catch { return 'Enter a valid URL'; } } }));
            if (u === CANCEL) return CANCEL; S.nodeUrl = u.trim();
            return true;
        },

        // 3 · Telegram
        async (i) => {
            const nav = await navBar('3/7  Telegram', i);
            if (nav === 'cancel') return CANCEL;
            if (nav === 'back')   return BACK;
            const en = await ask(() => confirm({ message: pc.cyan('3/7') + '  Enable Telegram bot?', initialValue: S.telegramEnabled }));
            if (en === CANCEL) return CANCEL; S.telegramEnabled = en;
            if (en) {
                const tok = await ask(() => text({ message: pc.cyan('3/7') + '  Bot Token', placeholder: '123456:ABC-xxx', initialValue: S.telegramToken, validate: v => v.trim() ? undefined : 'Required' }));
                if (tok === CANCEL) return CANCEL; S.telegramToken = tok.trim();
                const cid = await ask(() => text({ message: pc.cyan('3/7') + '  Allowed IDs (Telegram numeric or WhatsApp @jid, comma-separated)', placeholder: '7733493073,number@s.whatsapp.net', initialValue: S.allowedIds }));
                if (cid === CANCEL) return CANCEL; S.allowedIds = cid.trim();
            }
            return true;
        },

        // 4 · WhatsApp & Slack
        async (i) => {
            const nav = await navBar('4/7  WhatsApp & Slack', i);
            if (nav === 'cancel') return CANCEL;
            if (nav === 'back')   return BACK;
            
            const enWa = await ask(() => confirm({ message: pc.cyan('4/7') + '  Enable WhatsApp? (needs @whiskeysockets/baileys)', initialValue: S.whatsappEnabled }));
            if (enWa === CANCEL) return CANCEL; S.whatsappEnabled = enWa;
            if (enWa) {
                const dir = await ask(() => text({ message: pc.cyan('4/7') + '  Baileys auth directory', placeholder: './auth_info_baileys', initialValue: S.whatsappAuthDir }));
                if (dir === CANCEL) return CANCEL; S.whatsappAuthDir = dir.trim() || './auth_info_baileys';
                const dbg = await ask(() => confirm({ message: pc.cyan('4/7') + '  Enable WhatsApp verbose debug?', initialValue: S.whatsappDebug }));
                if (dbg === CANCEL) return CANCEL; S.whatsappDebug = dbg;
                
                // Also ask for Allowed IDs if not already asked in Telegram step
                if (!S.telegramEnabled) {
                    const cid = await ask(() => text({ message: pc.cyan('4/7') + '  Allowed IDs (WhatsApp @jid or Telegram numeric, comma-separated)', placeholder: 'number@s.whatsapp.net,7733493073', initialValue: S.allowedIds }));
                    if (cid === CANCEL) return CANCEL; S.allowedIds = cid.trim();
                }

                note('WhatsApp shows a QR code on first start.\nScan with WhatsApp mobile to link the session.', pc.yellow('WhatsApp Pairing'));
            }

            const enSl = await ask(() => confirm({ message: pc.cyan('4/7') + '  Enable Slack integration?', initialValue: S.slackEnabled }));
            if (enSl === CANCEL) return CANCEL; S.slackEnabled = enSl;
            if (enSl) {
                const tok = await ask(() => text({ message: pc.cyan('4/7') + '  Slack Bot Token (xoxb-…)', placeholder: 'xoxb-xxx', initialValue: S.slackBotToken, validate: v => v.trim().startsWith('xoxb-') ? undefined : 'Must start with xoxb-' }));
                if (tok === CANCEL) return CANCEL; S.slackBotToken = tok.trim();
                const ch = await ask(() => text({ message: pc.cyan('4/7') + '  Default Slack channel ID', placeholder: 'C0123456789', initialValue: S.slackChannel }));
                if (ch === CANCEL) return CANCEL; S.slackChannel = ch.trim();
            }
            return true;
        },

        // 5 · Discord
        async (i) => {
            const nav = await navBar('5/8  Discord', i);
            if (nav === 'cancel') return CANCEL;
            if (nav === 'back')   return BACK;
            const en = await ask(() => confirm({ message: pc.cyan('5/8') + '  Enable Discord integration?', initialValue: S.discordEnabled }));
            if (en === CANCEL) return CANCEL; S.discordEnabled = en;
            if (en) {
                const tok = await ask(() => text({ message: pc.cyan('5/8') + '  Discord Bot Token', placeholder: 'MTxxx.xxx.xxx', initialValue: S.discordBotToken, validate: v => v.trim() ? undefined : 'Required' }));
                if (tok === CANCEL) return CANCEL; S.discordBotToken = tok.trim();
                const chId = await ask(() => text({ message: pc.cyan('5/8') + '  Discord Channel ID', placeholder: '123456789012345678', initialValue: S.discordChannelId }));
                if (chId === CANCEL) return CANCEL; S.discordChannelId = chId.trim();
            }
            return true;
        },

        // 6 · SMS, USSD & Email
        async (i) => {
            const nav = await navBar('6/8  SMS, USSD & Email', i);
            if (nav === 'cancel') return CANCEL;
            if (nav === 'back')   return BACK;

            // ── SMS ────────────────────────────────────────────────────────
            const enSms = await ask(() => confirm({ message: pc.cyan('6/8') + '  Enable SMS channel?', initialValue: S.smsEnabled }));
            if (enSms === CANCEL) return CANCEL; S.smsEnabled = enSms;

            if (enSms) {
                const prov = await ask(() => select({
                    message: pc.cyan('6/8') + '  SMS provider',
                    initialValue: S.smsProvider,
                    options: [
                        { value: 'twilio', label: pc.white('Twilio')     + pc.dim('  (global)') },
                        { value: 'econet', label: pc.white('Econet A2A') + pc.dim('  (Zimbabwe)') },
                    ],
                }));
                if (prov === CANCEL) return CANCEL; S.smsProvider = prov;

                if (prov === 'twilio') {
                    const sid = await ask(() => text({ message: pc.cyan('6/8') + '  Twilio Account SID', placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', initialValue: S.twilioSid, validate: v => v.trim() ? undefined : 'Required' }));
                    if (sid === CANCEL) return CANCEL; S.twilioSid = sid.trim();
                    const tok = await ask(() => clackPwd({ message: pc.cyan('6/8') + '  Twilio Auth Token', validate: v => v.length >= 8 ? undefined : 'Too short' }));
                    if (tok === CANCEL) return CANCEL; S.twilioToken = tok;
                    const frm = await ask(() => text({ message: pc.cyan('6/8') + '  Twilio From Number (E.164)', placeholder: '+12025551234', initialValue: S.twilioFrom, validate: v => v.trim().startsWith('+') ? undefined : 'Must be E.164 (+…)' }));
                    if (frm === CANCEL) return CANCEL; S.twilioFrom = frm.trim();
                }

                if (prov === 'econet') {
                    const url = await ask(() => text({ message: pc.cyan('6/8') + '  Econet Base URL', placeholder: 'https://api.econet.co.zw', initialValue: S.econetBaseUrl }));
                    if (url === CANCEL) return CANCEL; S.econetBaseUrl = url.trim() || 'https://api.econet.co.zw';
                    const cid = await ask(() => text({ message: pc.cyan('6/8') + '  Econet Client ID', placeholder: 'your-client-id', initialValue: S.econetClientId, validate: v => v.trim() ? undefined : 'Required' }));
                    if (cid === CANCEL) return CANCEL; S.econetClientId = cid.trim();
                    const csec = await ask(() => clackPwd({ message: pc.cyan('6/8') + '  Econet Client Secret', validate: v => v.length >= 4 ? undefined : 'Too short' }));
                    if (csec === CANCEL) return CANCEL; S.econetClientSecret = csec;
                    const fn = await ask(() => text({ message: pc.cyan('6/8') + '  Econet From Name (sender ID)', placeholder: 'AgentOS', initialValue: S.econetFromName }));
                    if (fn === CANCEL) return CANCEL; S.econetFromName = fn.trim() || 'AgentOS';
                }
            }

            // ── USSD (AfricasTalking) ────────────────────────────────────
            const enUssd = await ask(() => confirm({ message: pc.cyan('6/8') + '  Enable USSD channel? (AfricasTalking)', initialValue: S.ussdEnabled }));
            if (enUssd === CANCEL) return CANCEL; S.ussdEnabled = enUssd;

            if (enUssd) {
                const atUser = await ask(() => text({ message: pc.cyan('6/8') + '  AfricasTalking Username', placeholder: 'sandbox', initialValue: S.atUsername, validate: v => v.trim() ? undefined : 'Required' }));
                if (atUser === CANCEL) return CANCEL; S.atUsername = atUser.trim();
                const atKey = await ask(() => clackPwd({ message: pc.cyan('6/8') + '  AfricasTalking API Key', validate: v => v.length >= 4 ? undefined : 'Too short' }));
                if (atKey === CANCEL) return CANCEL; S.atApiKey = atKey;
                const sc = await ask(() => text({ message: pc.cyan('6/8') + '  USSD Service Code', placeholder: '*123#', initialValue: S.ussdServiceCode }));
                if (sc === CANCEL) return CANCEL; S.ussdServiceCode = sc.trim();
            }

            // ── Email (SMTP) ─────────────────────────────────────────────
            const enEmail = await ask(() => confirm({ message: pc.cyan('6/8') + '  Enable Email channel? (SMTP)', initialValue: S.emailEnabled }));
            if (enEmail === CANCEL) return CANCEL; S.emailEnabled = enEmail;

            if (enEmail) {
                const host = await ask(() => text({ message: pc.cyan('6/8') + '  SMTP Host', placeholder: 'smtp.gmail.com', initialValue: S.smtpHost, validate: v => v.trim() ? undefined : 'Required' }));
                if (host === CANCEL) return CANCEL; S.smtpHost = host.trim();
                const port = await ask(() => text({ message: pc.cyan('6/8') + '  SMTP Port', placeholder: '587', initialValue: S.smtpPort }));
                if (port === CANCEL) return CANCEL; S.smtpPort = port.trim() || '587';
                const user = await ask(() => text({ message: pc.cyan('6/8') + '  SMTP Username', placeholder: 'you@example.com', initialValue: S.smtpUser, validate: v => v.trim() ? undefined : 'Required' }));
                if (user === CANCEL) return CANCEL; S.smtpUser = user.trim();
                const pass = await ask(() => clackPwd({ message: pc.cyan('6/8') + '  SMTP Password', validate: v => v.length >= 1 ? undefined : 'Required' }));
                if (pass === CANCEL) return CANCEL; S.smtpPass = pass;
                const from = await ask(() => text({ message: pc.cyan('6/8') + '  From Address', placeholder: 'agentos@yourdomain.com', initialValue: S.smtpFrom }));
                if (from === CANCEL) return CANCEL; S.smtpFrom = from.trim();
            }

            return true;
        },

        // 7 · Skills / Debug
        async (i) => {
            const nav = await navBar('7/8  Skills & Debug', i);
            if (nav === 'cancel') return CANCEL;
            if (nav === 'back')   return BACK;
            const lvl = await ask(() => select({
                message: pc.cyan('7/8') + '  Log level',
                initialValue: S.logLevel,
                options: [
                    { value: 'error', label: pc.red('error')   + pc.dim('  errors only') },
                    { value: 'warn',  label: pc.yellow('warn') + pc.dim('  warnings + errors') },
                    { value: 'info',  label: pc.green('info')  + pc.dim('  standard (recommended)') },
                    { value: 'debug', label: pc.cyan('debug')  + pc.dim(' verbose') },
                    { value: 'trace', label: pc.dim('trace')   + pc.dim(' all output (noisy)') },
                ],
            }));
            if (lvl === CANCEL) return CANCEL; S.logLevel = lvl;
            const dbg = await ask(() => confirm({ message: pc.cyan('7/8') + '  Enable skills debug? (DEBUG=agentos:*)', initialValue: S.skillsDebug }));
            if (dbg === CANCEL) return CANCEL; S.skillsDebug = dbg;
            const channels = [S.telegramEnabled && 'telegram', S.whatsappEnabled && 'whatsapp', S.slackEnabled && 'slack', S.discordEnabled && 'discord', S.smsEnabled && 'sms', S.ussdEnabled && 'ussd', S.emailEnabled && 'email'].filter(Boolean);
            note([
                `Channels: ${channels.length ? pc.green(channels.join(', ')) : pc.dim('none')}`,
                `Log level: ${pc.yellow(S.logLevel)}`,
                `Skills debug: ${S.skillsDebug ? pc.cyan('ON') : pc.dim('OFF')}`,
            ].join('\n'), 'Summary');
            return true;
        },

        // 8 · Confirm
        async (i) => {
            const nav = await navBar('8/8  Confirm & Run', i);
            if (nav === 'cancel') return CANCEL;
            if (nav === 'back')   return BACK;
            const dry = await ask(() => confirm({ message: pc.cyan('8/8') + '  Dry run? (scripts uploaded, not executed)', initialValue: S.dryRun }));
            if (dry === CANCEL) return CANCEL; S.dryRun = dry;
            note([
                `Router:    ${pc.white(S.host + ':' + S.port)}  user: ${S.user}`,
                `Node URL:  ${pc.white(S.nodeUrl)}`,
                `Telegram:  ${S.telegramEnabled ? pc.green('yes') : pc.dim('no')}`,
                `WhatsApp:  ${S.whatsappEnabled ? pc.green('yes') : pc.dim('no')} ${S.whatsappDebug ? pc.cyan('(debug)') : ''}`,
                `Slack:     ${S.slackEnabled    ? pc.green('yes') : pc.dim('no')}`,
                `Discord:   ${S.discordEnabled  ? pc.green('yes') : pc.dim('no')}`,
                `SMS:       ${S.smsEnabled      ? pc.green('yes') : pc.dim('no')}`,
                `USSD:      ${S.ussdEnabled     ? pc.green('yes') : pc.dim('no')}`,
                `Email:     ${S.emailEnabled    ? pc.green('yes') : pc.dim('no')}`,
                `Log level: ${pc.yellow(S.logLevel)}  Debug: ${S.skillsDebug ? pc.cyan('ON') : pc.dim('OFF')}`,
                `Dry run:   ${S.dryRun ? pc.yellow('YES') : pc.dim('NO')}`,
            ].join('\n'), 'Final Configuration');
            const go = await ask(() => confirm({ message: pc.bold('Proceed with onboarding?') }));
            if (go === CANCEL || !go) return CANCEL;
            return true;
        },
    ];

    // Step loop — supports back navigation
    let cur = 0;
    while (cur < STEPS.length) {
        const r = await STEPS[cur](cur);
        if (r === CANCEL) { cancel('Setup cancelled.'); return; }
        if (r === BACK)   { cur = Math.max(0, cur - 1); continue; }
        cur++;
    }

    // Write .env.agentos
    const envLines = [
        `MIKROTIK_IP=${S.host}`,
        `MIKROTIK_USER=${S.user}`,
        `MIKROTIK_PASSWORD=${S.pass}`,
        `MIKROTIK_PORT=${S.port}`,
        `AGENTOS_NODE_URL=${S.nodeUrl}`,
        `TELEGRAM_ENABLED=${S.telegramEnabled}`,
        S.telegramEnabled  ? `TELEGRAM_TOKEN=${S.telegramToken}`        : '',
        (S.telegramEnabled || S.whatsappEnabled) && S.allowedIds ? `ALLOWED_CHAT_IDS=${S.allowedIds}` : '',
        `WHATSAPP_ENABLED=${S.whatsappEnabled}`,
        S.whatsappEnabled  ? `WHATSAPP_AUTH_DIR=${S.whatsappAuthDir}`   : '',
        `SLACK_ENABLED=${S.slackEnabled}`,
        S.slackEnabled     ? `SLACK_BOT_TOKEN=${S.slackBotToken}`       : '',
        S.slackEnabled     ? `SLACK_CHANNEL=${S.slackChannel}`          : '',
        `DISCORD_ENABLED=${S.discordEnabled}`,
        S.discordEnabled   ? `DISCORD_BOT_TOKEN=${S.discordBotToken}`   : '',
        S.discordEnabled   ? `DISCORD_CHANNEL_ID=${S.discordChannelId}` : '',
        `SMS_ENABLED=${S.smsEnabled}`,
        S.smsEnabled ? `SMS_PROVIDER=${S.smsProvider}` : '',
        // Twilio
        S.smsEnabled && S.smsProvider === 'twilio' && S.twilioSid    ? `TWILIO_ACCOUNT_SID=${S.twilioSid}`       : '',
        S.smsEnabled && S.smsProvider === 'twilio' && S.twilioToken  ? `TWILIO_AUTH_TOKEN=${S.twilioToken}`      : '',
        S.smsEnabled && S.smsProvider === 'twilio' && S.twilioFrom   ? `TWILIO_FROM_NUMBER=${S.twilioFrom}`      : '',
        // Econet A2A
        S.smsEnabled && S.smsProvider === 'econet' && S.econetClientId     ? `ECONET_BASE_URL=${S.econetBaseUrl}`           : '',
        S.smsEnabled && S.smsProvider === 'econet' && S.econetClientId     ? `ECONET_CLIENT_ID=${S.econetClientId}`         : '',
        S.smsEnabled && S.smsProvider === 'econet' && S.econetClientSecret ? `ECONET_CLIENT_SECRET=${S.econetClientSecret}` : '',
        S.smsEnabled && S.smsProvider === 'econet'                         ? `ECONET_FROM_NAME=${S.econetFromName}`         : '',
        // USSD (AfricasTalking)
        `USSD_ENABLED=${S.ussdEnabled}`,
        S.ussdEnabled && S.atUsername  ? `AT_USERNAME=${S.atUsername}`         : '',
        S.ussdEnabled && S.atApiKey    ? `AT_API_KEY=${S.atApiKey}`           : '',
        S.ussdEnabled && S.ussdServiceCode ? `USSD_SERVICE_CODE=${S.ussdServiceCode}` : '',
        // Email (SMTP)
        `EMAIL_ENABLED=${S.emailEnabled}`,
        S.emailEnabled && S.smtpHost ? `SMTP_HOST=${S.smtpHost}`   : '',
        S.emailEnabled              ? `SMTP_PORT=${S.smtpPort}`   : '',
        S.emailEnabled && S.smtpUser ? `SMTP_USER=${S.smtpUser}`  : '',
        S.emailEnabled && S.smtpPass ? `SMTP_PASS=${S.smtpPass}`  : '',
        S.emailEnabled && S.smtpFrom ? `SMTP_FROM=${S.smtpFrom}`  : '',
        `LOG_LEVEL=${S.logLevel}`,
        S.skillsDebug ? `DEBUG=agentos:*` : '',
        S.whatsappDebug ? `WHATSAPP_DEBUG=true` : '',
    ].filter(Boolean).join('\n');

    const envPath = path.join(process.cwd(), '.env.agentos');
    try {
        await fs.writeFile(envPath, envLines + '\n', 'utf8');
        note(`Saved to ${pc.cyan('.env.agentos')}\nMerge with:\n${pc.dim('cat .env.agentos >> .env')}`, 'Environment written');
    } catch (e) {
        logger.warn(`Could not write .env.agentos: ${e.message}`);
    }

    const s = spinner();
    s.start(pc.cyan('Connecting and applying scripts…'));
    try {
        const result = await onboardRouter({
            host: S.host, user: S.user, password: S.pass,
            port: parseInt(S.port, 10) || 8728,
            AGENTOS_NODE_URL: S.nodeUrl,
            whatsappEnabled: S.whatsappEnabled,
            dryRun: S.dryRun,
        });
        s.stop(result.success ? pc.green('✔  Onboarding complete!') : pc.red(`✘  Failed: ${result.error}`));
        outro(result.success ? pc.green('AgentOS is ready 🚀') : pc.red('Check logs for details.'));
    } catch (err) {
        s.stop(pc.red(`✘  Error: ${err.message}`));
        outro(pc.red('Onboarding encountered an unexpected error.'));
    }
}

// Allow direct invocation: node src/core/onboard.js wizard
if (require.main === module && process.argv[2] === 'wizard') {
    runWizard().catch(console.error);
}

module.exports = {
    templateRsc,
    onboardRouter,
    onboardFleet,
    provisionAgents,
    generateSetupScript,
    generateMissionControl,
    runWizard
};

