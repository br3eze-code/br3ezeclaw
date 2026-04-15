#!/usr/bin/env python3
import sys, json, ssl
from pyVim.connect import SmartConnect, Disconnect
from pyVmomi import vim

def main():
    req = json.loads(sys.stdin.read())
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    si = SmartConnect(host=req['host'], user=req['user'], pwd=req['password'], sslContext=ctx)
    content = si.RetrieveContent()

    try:
        if req['action'] == 'vms.list':
            vms = []
            container = content.viewManager.CreateContainerView(content.rootFolder, [vim.VirtualMachine], True)
            for vm in container.view:
                vms.append({
                    'name': vm.name,
                    'power': str(vm.runtime.powerState),
                    'guest': vm.guest.guestFullName,
                    'ip': vm.guest.ipAddress,
                    'cpu': vm.config.hardware.numCPU,
                    'mem_mb': vm.config.hardware.memoryMB
                })
            print(json.dumps(vms))

        elif req['action'] == 'vm.power':
            vm = next((v for v in content.viewManager.CreateContainerView(content.rootFolder, [vim.VirtualMachine], True).view if v.name == req['vm']), None)
            if not vm: raise Exception(f"VM {req['vm']} not found")
            task = vm.PowerOn() if req['state'] == 'on' else vm.PowerOff()
            print(json.dumps({'task': str(task)}))

        elif req['action'] == 'vm.reboot':
            vm = next((v for v in content.viewManager.CreateContainerView(content.rootFolder, [vim.VirtualMachine], True).view if v.name == req['vm']), None)
            if not vm: raise Exception(f"VM {req['vm']} not found")
            vm.RebootGuest()
            print(json.dumps({'status': 'guest_reboot_initiated'}))

    finally:
        Disconnect(si)

if __name__ == "__main__":
    main()
