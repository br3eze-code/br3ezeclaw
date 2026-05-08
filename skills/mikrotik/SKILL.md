# Skill: mikrotik

**Version:** 2026.7.0  
**Dispatcher:** `manage_network`  
**Domain:** networking

## Description

Full MikroTik RouterOS v7 management — hotspot users, firewall rules, system stats, network diagnostics, and wireless control. Uses the `routeros-client` API on port 8728.

## When to Use

Invoke when the user asks about:
- Active WiFi users / hotspot sessions
- Disconnecting, adding, or removing hotspot users
- Firewall blocking/unblocking an IP or MAC
- Router CPU, RAM, uptime, or interface stats
- Pinging or tracerouting from the router
- DNS cache flush
- Router reboot or backup
- DHCP leases, ARP table, wireless clients, routing table

## Tools

### read-only
| Tool | Description |
|---|---|
| `system.stats` | CPU, RAM, uptime, interface stats |
| `users.active` | List currently connected hotspot users |
| `users.all` | List all provisioned hotspot users |
| `dhcp.leases` | Show DHCP leases |
| `arp.table` | Show ARP table |
| `interfaces` | List interfaces and link state |
| `wireless.clients` | List wireless associations |
| `ip.routes` | Show routing table |

### workspace-write (default)
| Tool | Description |
|---|---|
| `user.add` | Create hotspot user (profile, password, limit) |
| `user.remove` | Delete a hotspot user |
| `user.kick` | Disconnect an active session |
| `firewall.block` | Add drop rule for IP or MAC |
| `firewall.unblock` | Remove drop rule |
| `ping` | Ping test from router |
| `traceroute` | Traceroute from router |
| `dns.flush` | Flush RouterOS DNS cache |

### danger-full-access
| Tool | Description |
|---|---|
| `system.reboot` | Reboot router — requires `confirm: true` |
| `system.backup` | Create RouterOS config backup |
| `wireless.set_frequency` | Change wireless channel/frequency |

## Parameters

```json
{
  "action": "user.kick",
  "router": "main",
  "params": { "username": "alice" }
}
```

## Security Rules

- Never expose passwords in responses
- Always confirm destructive actions (kick / remove / reboot)
- `executeCLI()` rejects shell metacharacters `` ` $ ( ) { } | ; & < > ``
- All changes are logged to the rolling audit buffer

## Configuration

| Env Var | Default | Description |
|---|---|---|
| `MIKROTIK_IP` | `192.168.88.1` | Router IP address |
| `MIKROTIK_PORT` | `8728` | RouterOS API port |
| `MIKROTIK_USER` | `admin` | Router username |
| `MIKROTIK_PASS` | *(required)* | Router password |
