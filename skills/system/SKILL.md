# Skill: system

**Version:** 1.0.0  
**Domain:** system

## Description

AgentOS host-level diagnostics and utilities — ping from the AgentOS server, health checks across all loaded skills, audit log retrieval, and a tool listing command.

## When to Use

Invoke when the user asks about:
- Pinging a host from the AgentOS server (not from the router)
- Running a health check on AgentOS (`doctor`)
- Viewing recent audit logs for the current user
- Listing available tools

## Tools

| Tool | Risk | Description |
|---|---|---|
| `sys.ping` | low | Ping a host from the AgentOS server (up to 10 packets) |
| `sys.doctor` | low | Run health checks on AgentOS and all registered skills |
| `sys.audit` | low | Get audit logs for the current user (last N hours, max 168) |
| `sys.help` | low | List tools available to the current user's role |

## Parameters

**Ping:**
```json
{ "host": "8.8.8.8", "count": 4 }
```

**Audit:**
```json
{ "hours": 24 }
```

## Notes

- `sys.ping` validates hostname with `/^[a-zA-Z0-9.-]+$/` — no shell injection possible
- `sys.doctor` iterates all `registry.drivers` and calls `healthCheck()` on each
- `sys.help` filters tools by the caller's role (read-only / workspace-write / danger-full-access)
- This skill runs on the **AgentOS host**, not on the MikroTik router. For router-level ping, use the `mikrotik` skill's `ping` tool.
