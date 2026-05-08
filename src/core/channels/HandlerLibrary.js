/**
 * HandlerLibrary.js
 * Common logic for all AgentOS messaging channel commands.
 * Shared between Telegram, WhatsApp, Slack, and Discord.
 */

const os = require('os');
const chalk = require('chalk');
const { logger } = require('../logger');

const HandlerLibrary = {
  /**
   * /dashboard
   */
  async handleDashboard(channel, jid) {
    const { getDatabase } = require('../database');
    const db = await getDatabase();
    const stats = await db.getStats();
    const uptime = Math.floor(process.uptime());
    
    // CPU & RAM
    const load = os.loadavg()[0];
    const cpuUsage = Math.round(load * 100) / 100;
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = Math.round(((totalMem - freeMem) / totalMem) * 100);

    const statusEmoji = cpuUsage > 2.0 || memUsage > 90 ? '🟡' : '🟢';
    
    let text = `📊 *${global.AGENTOS.BRAND.name} Dashboard*\n`;
    text += `• *Status:* ${statusEmoji} Optimal\n`;
    text += `• *Uptime:* ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m\n`;
    text += `• *Revenue (Today):* ₱${stats.todayRevenue || 0}\n`;
    text += `• *Active Users:* ${stats.activeUsers || 0}\n`;
    text += `• *CPU Load:* ${cpuUsage}\n`;
    text += `• *RAM Usage:* ${memUsage}%\n`;
    
    await channel.send(jid, text);
  },

  /**
   * /stats
   */
  async handleStats(channel, jid) {
    const mt = global.mikrotik;
    let text = `🌡️ *Hardware Telemetry*\n`;
    
    if (mt && mt.state.isConnected) {
      try {
        const res = await mt.getSystemResources();
        const r = res[0] || {};
        text += `• *Model:* ${r['board-name'] || 'MikroTik'}\n`;
        text += `• *CPU:* ${r.cpu} @ ${r['cpu-frequency']}MHz\n`;
        text += `• *Uptime:* ${r.uptime}\n`;
        text += `• *Version:* ${r.version}\n`;
        if (r.voltage) text += `• *Voltage:* ${r.voltage}V\n`;
        if (r.temperature) text += `• *Temp:* ${r.temperature}°C\n`;
      } catch (err) {
        text += `• _Router metrics unavailable_\n`;
      }
    } else {
      text += `• _Router disconnected_\n`;
    }
    
    text += `\n🤖 *Software Stats*\n`;
    text += `• *Node:* ${process.version}\n`;
    text += `• *PID:* ${process.pid}\n`;
    text += `• *Platform:* ${process.platform}`;
    
    await channel.send(jid, text);
  },

  /**
   * /network
   */
  async handleNetwork(channel, jid) {
    const mt = global.mikrotik;
    if (!mt || !mt.state.isConnected) return channel.send(jid, '❌ *Router disconnected.*');

    try {
      const interfaces = await mt.getInterfaces();
      const dhcp = await mt.getDhcpLeases();
      
      let text = `🌐 *Network Status*\n\n`;
      text += `*Interfaces:*\n`;
      interfaces.forEach(i => {
        const status = i.running === 'true' ? '✅' : '❌';
        text += `${status} *${i.name}* (${i.type})\n`;
      });

      text += `\n*DHCP Leases:* ${dhcp.length}\n`;
      dhcp.slice(0, 10).forEach(l => {
        text += `• ${l.address} - ${l['host-name'] || 'unknown'}\n`;
      });
      if (dhcp.length > 10) text += `• _...and ${dhcp.length - 10} more_\n`;

      await channel.send(jid, text);
    } catch (err) {
      await channel.send(jid, `❌ *Network error:* ${err.message}`);
    }
  },

  /**
   * /users
   */
  async handleUsers(channel, jid) {
    const mt = global.mikrotik;
    if (!mt || !mt.state.isConnected) return channel.send(jid, '❌ *Router disconnected.*');

    try {
      const active = await mt.getHotspotActive();
      let text = `👥 *Active Hotspot Users: ${active.length}*\n\n`;
      active.slice(0, 15).forEach(u => {
        text += `• *${u.user}* - ${u.address} (${u.uptime})\n`;
      });
      if (active.length > 15) text += `• _...and ${active.length - 15} more_\n`;
      
      await channel.send(jid, text);
    } catch (err) {
      await channel.send(jid, `❌ *User list error:* ${err.message}`);
    }
  },

  /**
   * /bulk <plan> <qty>
   */
  async handleBulkVoucher(channel, jid, msg, args) {
    if (args.length < 3) return channel.send(jid, '📝 *Usage:* `/bulk <plan> <qty>`');
    
    const plan = args[1];
    const qty = parseInt(args[2]);
    if (isNaN(qty) || qty < 1 || qty > 50) return channel.send(jid, '❌ *Quantity must be between 1 and 50.*');

    const { getDatabase } = require('../database');
    const db = await getDatabase();
    const mt = global.mikrotik;
    const codes = [];

    await channel.send(jid, `⏳ *Generating ${qty} vouchers for ${plan}...*`);

    try {
      for (let i = 0; i < qty; i++) {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        await db.createVoucher(code, { plan, createdBy: jid });
        if (mt && mt.state.isConnected) {
          await mt.addHotspotUser({ username: code, password: code, profile: plan });
        }
        codes.push(code);
      }

      let text = `✅ *Bulk Generation Complete!* (${qty} vouchers)\n\n`;
      text += `\`${codes.join(', ')}\``;
      
      await channel.send(jid, text);
    } catch (err) {
      await channel.send(jid, `❌ *Bulk error:* ${err.message}`);
    }
  },

  /**
   * /voucher <plan>
   */
  async handleVoucher(channel, jid, msg, args) {
    if (args.length < 2) return channel.send(jid, '📝 *Usage:* `/voucher <plan_name>`');
    
    const plan = args[1];
    const { getDatabase } = require('../database');
    const db = await getDatabase();
    const mt = global.mikrotik;

    try {
      // Generate code
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      
      // Update DB
      await db.createVoucher(code, { plan, createdBy: jid });
      
      // Add to MikroTik if connected
      if (mt && mt.state.isConnected) {
        await mt.addHotspotUser({ username: code, password: code, profile: plan });
      }

      await channel.send(jid, `🎫 *Voucher Created!*\n\n*Code:* \`${code}\`\n*Plan:* ${plan}\n\n_Note: This has been added to the router automatically._`);
    } catch (err) {
      await channel.send(jid, `❌ *Voucher error:* ${err.message}`);
    }
  },

  /**
   * /ping
   */
  async handlePing(channel, jid) {
    const start = Date.now();
    await channel.send(jid, '🏓 *Pong!*');
    const end = Date.now();
    await channel.send(jid, `⏱️ *Latency:* ${end - start}ms`);
  }
};

module.exports = HandlerLibrary;
