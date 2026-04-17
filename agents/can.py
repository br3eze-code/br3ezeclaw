# /workers/can.py
import can, cantools, sys, json, time, threading
from pathlib import Path

args = json.loads(sys.argv[1])
bus = None
db = None
buffer = []

def start():
    global bus, db
    db = cantools.database.load_file(args['dbc_file'])
    bus = can.interface.Bus(channel=args['device'], bustype='socketcan', bitrate=args['baudrate'])
    # Background thread decodes frames
    def reader():
        while True:
            msg = bus.recv(1)
            if msg:
                try:
                    decoded = db.decode_message(msg.arbitration_id, msg.data)
                    buffer.append({**decoded, 'ts': time.time()})
                    if len(buffer) > 1000: buffer.pop(0) # keep 1s at 1000Hz
                except: pass
    threading.Thread(target=reader, daemon=True).start()
    print(json.dumps({"rate_hz": 1000, "channels": [s.name for s in db.messages[0].signals]}))

def snapshot():
    # Return last 1s of filtered channels
    now = time.time()
    data = [b for b in buffer if now - b['ts'] < 1.0]
    if args.get('channels'):
        data = [{k:v for k,v in d.items() if k in args['channels'] or k=='ts'} for d in data]
    print(json.dumps(data))

if 'can_start' in sys.argv[0]: start()
elif 'can_snapshot' in sys.argv[0]: snapshot()
