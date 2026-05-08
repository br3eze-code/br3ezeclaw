# Skill: project

**Version:** 2026.7.0  
**Dispatcher:** `manage_project`  
**Domain:** productivity

## Description

CPM (Critical Path Method) and EVM (Earned Value Management) project tracking engine. Stores projects in the AgentOS database, computes forward/backward passes to find the critical path, and calculates SPI, CPI, ETC, EAC, and other earned value metrics. EVM data sources: voucher revenue as EV/PV, LLM token spend + infra cost as AC.

## When to Use

Invoke when the user asks about:
- Creating or managing a project with tasks and dependencies
- Finding the critical path or schedule float
- Calculating earned value metrics (SPI, CPI, EAC, VAC…)
- Generating a CPM + EVM combined project report
- Exporting project data

## Tools (9 Actions)

| Action | Description |
|---|---|
| `project.create` | Create project with tasks, dependencies, and BAC |
| `project.list` | List all projects |
| `project.get` | Get project by ID |
| `project.update` | Update project or task fields |
| `project.delete` | Delete a project |
| `project.critical_path` | Run CPM — returns ES/EF/LS/LF/float and critical path |
| `project.evm` | Calculate EVM metrics |
| `project.report` | Combined CPM + EVM report with health indicators |
| `project.export` | Export full project data as JSON |

## CPM Algorithm

- **Forward pass:** ES, EF computed via recursive dependency traversal
- **Backward pass:** LS, LF, float
- **Critical path:** all tasks where `float === 0`

## EVM Metrics

| Metric | Formula |
|---|---|
| SPI | EV / PV |
| CPI | EV / AC |
| SV | EV − PV |
| CV | EV − AC |
| ETC | (BAC − EV) / CPI |
| EAC | AC + ETC |
| VAC | BAC − EAC |
| TCPI | (BAC − EV) / (BAC − AC) |

## Example: Create Project

```json
{
  "action": "project.create",
  "project": {
    "name": "Network Expansion Q3",
    "bac": 5000,
    "tasks": [
      { "id": "t1", "title": "Site survey",      "duration": 2,  "dependencies": [],         "plannedValue": 500 },
      { "id": "t2", "title": "Cable install",    "duration": 5,  "dependencies": ["t1"],     "plannedValue": 2000 },
      { "id": "t3", "title": "Router config",    "duration": 3,  "dependencies": ["t2"],     "plannedValue": 1500 },
      { "id": "t4", "title": "User onboarding",  "duration": 2,  "dependencies": ["t3"],     "plannedValue": 1000 }
    ]
  }
}
```

## Example: EVM Report

```json
{
  "action": "project.report",
  "id": "proj-1234567890"
}
```
