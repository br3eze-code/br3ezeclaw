# /workers/print.py
import sys, json, subprocess, os, requests
from pathlib import Path
args = json.loads(sys.argv[1])

def slice_stl():
    out = args['output']
    # Quality presets map to layer height/infill
    presets = {
      'draft': {'layer': 0.3, 'infill': 10},
      'standard': {'layer': 0.2, 'infill': 20},
      'high': {'layer': 0.12, 'infill': 40}
    }
    p = presets[args['quality']]
    lh = args.get('layer_height', p['layer'])
    inf = args.get('infill', p['infill'])

    cmd = [
      'prusa-slicer','--export-gcode','--output',out,
      '--layer-height',str(lh),'--fill-density',f'{inf}%',
      '--support-material' if args['supports'] else '--no-support-material',
      '--scale',str(args['scale'])
    ]

    # Material profiles
    if args['material'] in ['PETG','ABS','ASA','Nylon','CF-Nylon']:
      cmd += ['--filament-type',args['material'],'--temperature', '240' if 'Nylon' in args['material'] else '230']
    cmd += [args['stl']]

    subprocess.run(cmd, check=True)

    # Parse G-code for time/material
    time_h = 0; mat_g = 0; layers = 0
    with open(out) as f:
      for line in f:
        if line.startswith('; estimated printing time'):
          # ; estimated printing time = 4h 32m 15s
          t = line.split('=')[1].strip()
          h = int(t.split('h')[0]) if 'h' in t else 0
          m = int(t.split('h')[1].split('m')[0].strip()) if 'm' in t else 0
          time_h = h + m/60
        if line.startswith('; filament used [g]'):
          mat_g = float(line.split('=')[1])
        if line.startswith(';LAYER_CHANGE'): layers += 1

    # Cost: $25/kg PETG, $60/kg CF-Nylon, $150/L Resin
    cost_per_kg = {'PETG':25,'ABS':25,'ASA':30,'Nylon':60,'CF-Nylon':80,'Resin':150}[args['material']]
    cost = mat_g/1000 * cost_per_kg

    print(json.dumps({
      "time_hours": round(time_h,2), "material_g": round(mat_g,1),
      "cost_usd": round(cost,2), "layers": layers,
      "preview_png": out.replace('.gcode','.png') # PrusaSlicer --export-png
    }))

def print_start():
    # Send to Moonraker/Klipper
    url = f"http://{args['printer_ip']}/printer/print/start"
    files = {'file': open(args['gcode'],'rb')}
    r = requests.post(url, files=files).json()
    # Get webcam
    web = f"http://{args['printer_ip']}/webcam/?action=stream"
    print(json.dumps({"id": r['result'], "time_hours": 4.5, "webcam_url": web}))

def quote_stl():
    # Quick volume calc for quote without full slice
    vol = subprocess.run(['admesh','--volume',args['stl']], capture_output=True, text=True)
    volume_cm3 = float(vol.stdout.split()[-1])
    # Rough: 1.24g/cm3 PETG, 1.1g/cm3 ABS, 1.0g/cm3 Resin
    density = {'PETG':1.24,'ABS':1.1,'CF-Nylon':1.3,'Resin':1.0,'Aluminum':2.7}[args['material']]
    mass_g = volume_cm3 * density * (args.get('infill',20)/100 + 0.1) # walls+infill
    time_h = volume_cm3 / 15 # ~15cm3/hr avg

    cost_table = {'fdm':25,'sla':150,'sls':300,'cnc':500} # $/kg or $/hr
    cost = mass_g/1000 * cost_table[args['process']] * args['quantity']
    if args['process']=='cnc': cost = time_h * 80 * args['quantity'] # $80/hr

    print(json.dumps({"time_hours":round(time_h,1),"cost_usd":round(cost,2)}))

if 'slice_stl' in sys.argv[0]: slice_stl()
elif 'print_start' in sys.argv[0]: print_start()
elif 'quote_stl' in sys.argv[0]: quote_stl()
