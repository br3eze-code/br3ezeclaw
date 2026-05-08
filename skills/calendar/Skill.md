# Skill: calendar

**Version:** 1.0.0  
**Domain:** productivity

## Description

Calendar event management with pluggable provider adapters — local (stored in agent memory), Google Calendar, and Outlook/Microsoft 365.

## When to Use

Invoke when the user asks about:
- Creating, listing, updating, or deleting calendar events
- Scheduling maintenance windows or cron-triggered tasks
- Checking scheduled reboots or operator meetings

## Tools

| Action | Description |
|---|---|
| `create` | Create a calendar event |
| `list` | List events within a date range |
| `update` | Update an existing event |
| `delete` | Delete an event by ID |

## Providers

| Provider | Description |
|---|---|
| `local` (default) | Stored in AgentOS agent memory |
| `google` | Google Calendar API |
| `outlook` | Microsoft Outlook / Microsoft 365 |

## Example: Create Event

```json
{
  "action": "create",
  "provider": "local",
  "event": {
    "title": "Router maintenance reboot",
    "start": "2026-05-10T04:00:00Z",
    "end":   "2026-05-10T04:15:00Z",
    "description": "Scheduled nightly reboot"
  }
}
```

## Example: List Events

```json
{
  "action": "list",
  "event": {
    "start": "2026-05-01T00:00:00Z",
    "end":   "2026-05-31T23:59:59Z"
  }
}
```
