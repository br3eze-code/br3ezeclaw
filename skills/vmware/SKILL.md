# Skill: vmware

**Version:** 1.0.0  
**Domain:** infrastructure

## Description

VMware vSphere VM management via a Python bridge (`bridge.py` using `pyVmomi`). Lists VMs, controls power state, and reboots guest OS on registered vCenter instances.

## When to Use

Invoke when the user asks about VMs on a vCenter — listing, powering on/off, or rebooting a guest OS.

## Tools

| Tool | Risk | Description |
|---|---|---|
| `vmw.vms.list` | low | List VMs in a vCenter |
| `vmw.vm.power` | high | Power on/off a VM — requires `reason` |
| `vmw.vm.reboot` | medium | Guest OS reboot — requires `reason` |

## Example

```json
{
  "vcenter": "vc-prod",
  "vm": "agentos-node-01",
  "state": "off",
  "reason": "Scheduled maintenance window"
}
```

## Notes

- `vcenter` must match a configured `workspace.vcenters` entry with `driver: vmware`
- Communicates via `bridge.py` (PythonShell in JSON mode)
- High-risk actions are logged with user ID and reason
