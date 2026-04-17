# /workers/dashboard.py
from flask import Flask, request, send_file, jsonify
import subprocess, json, sys

app = Flask(__name__)
args = json.loads(sys.argv[1]) # {port, html_path, season, round}

@app.route('/')
def index():
    return send_file(args['html_path'])

@app.route('/api/pitwall', methods=['POST'])
def pitwall():
    data = request.json
    # Call back into agentos via CLI - assumes agentos CLI exists
    cmd = ['agentos', 'agentos.pit_wall', 'action:auto', f'season:{data["season"]}', f'round:{data["round"]}', f'drivers:{",".join(data["drivers"])}']
    out = subprocess.run(cmd, capture_output=True, text=True)
    return jsonify(json.loads(out.stdout))

app.run(port=args['port'])
