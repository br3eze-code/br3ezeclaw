# Skill: windows

**Version:** 1.0.0  
**Domain:** system

## Description

Windows Server management via PowerShell remoting (WinRM). Supports service control, process management, Event Log queries, Active Directory user unlocking, and server reboots.

## When to Use

Invoke when the user asks about Windows services, processes, Event Log, AD accounts, or rebooting a Windows host.

## Tools

| Tool | Risk | Description |
|---|---|---|
| `win.service.status` | low | Get Windows service status (`*` for all) |
| `win.service.restart` | medium | Restart a named service — requires `reason` |
| `win.process.list` | low | Top processes by CPU or memory |
| `win.process.kill` | high | Kill process by PID — requires `reason` |
| `win.eventlog.query` | low | Query System/Application/Security event log |
| `win.ad.user.unlock` | medium | Unlock AD user account — requires `reason` |
| `win.system.reboot` | high | Reboot Windows Server — requires `reason` |

## Example

```json
{ "host": "dc01", "samAccountName": "jsmith", "reason": "Locked after VPN attempt" }
```

## Notes

- All medium/high-risk actions require an explicit `reason` string (logged with user ID)
- `host` must match a configured workspace `windows_hosts` entry
- Commands run via `Invoke-Command` over WinRM using stored credentials
