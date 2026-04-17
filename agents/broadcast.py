# /workers/broadcast.py
import sys, json, subprocess, time, os
from playwright.sync_api import sync_playwright

args = json.loads(sys.argv[1])

if 'start_stream' in sys.argv[0]:
    # 1. Start headless browser to render dashboard
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width':1920,'height':1080})
        page.goto(args['dashboard_url'])

        # 2. FFmpeg: x11grab or pipe from playwright -> RTMP
        cmd = [
            'ffmpeg','-f','x11grab','-video_size','1920x1080','-i',':99',
            '-f','alsa','-i','default', # add audio if needed
            '-c:v','libx264','-preset','veryfast','-b:v',args['bitrate'],
            '-maxrate',args['bitrate'],'-bufsize',args['bitrate'],
            '-pix_fmt','yuv420p','-g','60','-c:a','aac','-b:a','160k',
            '-f','flv',args['rtmp']
        ]
        proc = subprocess.Popen(cmd)

        # 3. Loop: update overlay files from pit_wall every 3s
        while True:
            try:
                # Call agentos.pit_wall via CLI to get latest
                out = subprocess.run(['agentos','agentos.pit_wall','action:snapshot',
                                     f'season:{args["season"]}',f'round:{args["round"]}'],
                                     capture_output=True, text=True)
                data = json.loads(out.stdout)
                with open('.agentos/f1/strategy.txt','w') as f:
                    f.write('\n'.join([f"{u['driver']}: {u['call']}" for u in data['updates']]))
                with open('.agentos/f1/radio.txt','w') as f:
                    f.write('\n'.join([f"{e['driver']}: {e['text']}" for e in data['events'] if e.get('type')=='RADIO'][-2:]))
                time.sleep(3)
            except: break

elif 'clip_stream' in sys.argv[0]:
    # Clip last 30s from stream buffer
    out = f"/mnt/data/clip_{int(time.time())}.mp4"
    cmd = ['ffmpeg','-sseof','-30','-i',args['rtmp'],'-c','copy',out]
    subprocess.run(cmd)
    print(json.dumps({"path": out}))
