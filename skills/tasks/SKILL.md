# Skill: tasks

**Version:** 2026.7.0  
**Dispatcher:** `manage_project`  
**Domain:** productivity

## Description

Task management with pluggable provider adapters (local agent memory, Todoist, Asana, Trello, Notion). Also exposes the 9 CPM+EVM project actions via the `manage_project` dispatcher shared with the `project` skill.

## When to Use

Invoke when the user asks about:
- Creating, listing, updating, deleting, or completing tasks
- Assigning a task to a team member
- Filtering tasks by status, priority, or project
- Managing tasks across external providers (Todoist, Asana, etc.)

## Tools

| Action | Description |
|---|---|
| `create` | Create a new task |
| `list` | List tasks (filter by status/priority/project) |
| `update` | Update task fields |
| `delete` | Delete a task |
| `assign` | Assign task to a user |
| `complete` | Mark task as completed |

## Providers

| Provider | Description |
|---|---|
| `local` (default) | Stored in AgentOS agent memory |
| `todoist` | Todoist API |
| `asana` | Asana API |
| `trello` | Trello API |
| `notion` | Notion API |

## Example: Create Task

```json
{
  "action": "create",
  "provider": "local",
  "task": {
    "title": "Check router firmware version",
    "priority": "high",
    "project": "maintenance",
    "dueDate": "2026-05-10"
  }
}
```

## Example: List Open Tasks

```json
{
  "action": "list",
  "filters": { "status": "open", "priority": "urgent" }
}
```

## Task Fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Auto-generated UUID |
| `title` | string | Task title |
| `description` | string | Optional detail |
| `priority` | `low\|medium\|high\|urgent` | Priority level |
| `dueDate` | ISO date string | Due date |
| `assignee` | string | Assigned user |
| `tags` | array | Label tags |
| `project` | string | Project grouping |
| `status` | `open\|in_progress\|completed` | Task status |
