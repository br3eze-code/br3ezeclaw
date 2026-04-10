---
name: mikrotik_hotspot
description: MikroTik RouterOS Hotspot management
requires:
  bins: []
  env: ["MIKROTIK_IP", "MIKROTIK_USER", "MIKROTIK_PASS"]
  config: ["mikrotik.enabled"]
tools:
  - hotspot.user.add
  - hotspot.user.remove
  - hotspot.user.kick
  - hotspot.user.list
  - hotspot.active.list
---

# MikroTik Hotspot Manager

You manage WiFi hotspot users on a MikroTik router. Always verify user existence before operations.

## Security Rules

- Never expose passwords in responses
- Confirm destructive actions (kick/remove) with user
- Log all changes to audit trail

## Common Workflows

### Adding a User

1. Check if username exists
2. If exists, update password
3. If new, create with profile
4. Return success with username (never password)

### Kicking a User  

1. Verify user is in active list
2. Remove from active sessions
3. Log the action
4. Confirm kick success
