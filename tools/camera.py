# /workers/camera.py
import sys, json, subprocess, os, requests
from datetime import datetime, timedelta

args = json.loads(sys.argv[1])
F1_API = "http://localhost:8000"
OUT = "/mnt/data"

# 1. Get session start time from Shaw API
sess = requests.get(f"{F1_API}/session/{args['season']}/{args['round']}/{args['session']}").json()
start_utc = datetime.fromisoformat(sess['start_time']) # "2026-04-13T13:00:00Z"

# 2. Calc clip start/end
event_time = datetime.fromisoformat(args['timestamp'].replace('Z','+00:00'))
clip_start = event_time - timedelta(seconds=args['duration'])
clip_end = event_time + timedelta(seconds=args['duration'])

# 3. FOM feed URL from Shaw API
fom_url = requests.get(f"{F1_API}/fom_feed?season={args['season']}&round={args['round']}&driver={args['driver']}").json()['url']

# 4. FFmpeg cut + overlay
out_file = f"{OUT}/{args['driver']}_{args['session']}_L{args.get('lap','X')}.mp4"
cmd = [
    'ffmpeg','-ss',str((clip_start - start_utc).total_seconds()),
    '-i',fom_url,'-t',str(args['duration']*2),
    '-vf',f"drawtext=text='{args.get('overlay_text','')}' :x=10:y=10:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5",
    '-c:v','libx264','-preset','fast', out_file
]
subprocess.run(cmd, check=True)

print(json.dumps({"path": out_file, "duration": args['duration']*2}))
