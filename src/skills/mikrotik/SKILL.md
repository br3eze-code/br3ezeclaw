# MikroTik Skill

Manage MikroTik RouterOS devices through the AgentOS OpenClaw gateway.

## Overview

This skill provides comprehensive MikroTik router management capabilities including hotspot user management, system monitoring, and network diagnostics.

## Tools

### User Management

- `mikrotik.user.kick` - Disconnect a hotspot user
- `mikrotik.user.add` - Create new hotspot user  
- `mikrotik.users.active` - List active sessions

### System Operations

- `mikrotik.system.stats` - CPU, memory, uptime
- `mikrotik.system.reboot` - Restart router (requires confirmation)

### Network Tools

- `mikrotik.network.ping` - ICMP ping test
- `mikrotik.network.traceroute` - Route tracing
- `mikrotik.firewall.list` - View firewall rules

## Configuration

Set in your `.env` file:

```bash
ROUTER_HOST=192.168.88.1
ROUTER_PORT=8728
ROUTER_USERNAME=admin
ROUTER_PASSWORD=yourpassword
```

Or configure per-request via the `config` parameter.

## Safety

The following operations require explicit confirmation:
- System reboot
- User disconnection (kick)
- Firewall modifications

## Examples

```javascript
// Kick a user
await runtime.executeTool('mikrotik.user.kick', { user: 'john' });

// Add a user
await runtime.executeTool('mikrotik.user.add', {
  username: 'guest',
  password: 'temp123',
  profile: '1Day'
});

// Get stats
const stats = await runtime.executeTool('mikrotik.system.stats', {});
```

