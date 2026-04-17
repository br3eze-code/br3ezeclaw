# /agents/kali.py
import sys, json, subprocess, re
args = json.loads(sys.argv[1])

def run(cmd): return subprocess.run(cmd, capture_output=True, text=True, timeout=60)

if 'nmap_discover' in sys.argv[0]:
    # -sn = ping sweep only, no port scan
    out = run(['nmap','-sn',args['target']]).stdout
    hosts = re.findall(r'Nmap scan report for (.+)', out)
    print(json.dumps({"hosts": hosts}))

elif 'nmap_scan' in sys.argv[0]:
    # -sV = version detect, -T4 = normal timing, --top-ports or range
    out = run(['nmap','-sV','-T4','-p',args['ports'],'--max-retries','1',args['target']]).stdout
    ports = re.findall(r'(\d+/tcp)\s+open\s+(\S+)', out)
    print(json.dumps({"ports": [p[0] for p in ports], "services": [p[1] for p in ports]}))

elif 'audit_service' in sys.argv[0]:
    findings = []
    if args['service']=='http':
        out = run(['nikto','-h',args['target'],'-Tuning','1']).stdout # Tuning 1 = no DoS
        findings = re.findall(r'\+ (.+)', out)[:10]
    elif args['service']=='can':
        # Check if CAN interface up, dump 1s of traffic for analysis
        out = run(['timeout','1','candump','can0']).stdout
        findings = [f"CAN frame: {l}" for l in out.split('\n')[:5] if l]
    print(json.dumps({"findings": findings}))
