# Skill: coding

**Version:** 1.0.0  
**Domain:** development

## Description

Code generation and execution for AgentOS automation tasks. Generates MikroTik scripts, Node.js snippets, shell commands, and RouterOS configuration blocks. Supports syntax validation before execution.

## When to Use

Invoke when the user asks about:
- Generating a RouterOS script for a specific task
- Writing a Node.js helper or automation snippet
- Generating shell commands for the AgentOS host
- Validating code before running it

## Tools

| Action | Description |
|---|---|
| `generate` | Generate code from a natural language description |
| `validate` | Check code for syntax errors and safety issues |
| `execute` | Run a validated script (sandboxed) |
| `explain` | Explain what a code snippet does |
| `refactor` | Improve or clean up existing code |

## Example: Generate RouterOS Script

```json
{
  "action": "generate",
  "language": "routeros",
  "description": "Block all traffic from IP 10.0.0.55 on the hotspot interface"
}
```

## Supported Languages

- `routeros` — MikroTik RouterOS scripting language
- `javascript` / `nodejs` — Node.js
- `bash` — Shell scripts for Linux
- `powershell` — Windows PowerShell

## Safety Rules

- `execute` only runs in a sandboxed environment
- RouterOS scripts are validated against the shell-injection denylist before execution
- No `eval()` or dynamic code loading in generated JavaScript
