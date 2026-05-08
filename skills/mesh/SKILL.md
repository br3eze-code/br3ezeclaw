# Skill: mesh

**Version:** 2026.7.0  
**Dispatcher:** `manage_mesh`  
**Domain:** networking

## Description

Multi-router mesh management via the AgentOS NodeRegistry. Supports registering router nodes, listing the fleet, executing a tool on a specific node, and broadcasting a tool call across all nodes simultaneously with parallel execution.

## When to Use

Invoke when the user asks about:
- Listing all registered routers in the mesh
- Adding a new router to the fleet
- Running a command on a specific router node
- Running a command across all routers at once

## Tools

| Action | Description |
|---|---|
| `nodes.list` | List all registered mesh nodes |
| `nodes.register` | Register a new router node |
| `nodes.exec` | Execute a tool on a specific named node |
| `mesh.exec` | Execute a tool on all nodes simultaneously |

## Parameters

**Register a node:**
```json
{
  "action": "nodes.register",
  "name": "site-b-router",
  "host": "192.168.10.1",
  "port": 8728,
  "user": "admin",
  "password": "secret",
  "role": "branch"
}
```

**Execute on specific node:**
```json
{
  "action": "nodes.exec",
  "name": "site-b-router",
  "tool": "users.active",
  "params": {}
}
```

**Execute across all nodes:**
```json
{
  "action": "mesh.exec",
  "tool": "system.stats",
  "params": {}
}
```

## Node Roles

| Role | Description |
|---|---|
| `core` | Primary/main gateway router |
| `branch` | Branch or site router |
| `edge` | Edge or access point |

## HTTP API

- `GET /api/nodes` — List nodes
- `POST /api/nodes` — Register node
- `POST /api/nodes/:name/exec` — Execute tool on node
- `GET /api/mesh/exec` — Execute tool on all nodes
