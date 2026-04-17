# /workers/gemma.py
import sys, json, base64
import ollama # pip install ollama

args = json.loads(sys.argv[1])
model = f"gemma4:{args['model_size']}" # ollama pull gemma4:9b

messages = [{"role": "system", "content": args['system']}]
user_msg = {"role": "user", "content": args['prompt']}

# Vision: add images
if args['action'] == 'vision' and args.get('images'):
    user_msg['images'] = args['images'] # ollama handles file paths

messages.append(user_msg)

opts = {
    "temperature": args.get('temperature', 0.2),
    "num_predict": args.get('max_tokens', 2048)
}

# JSON mode
if args['action'] == 'json' and args.get('schema'):
    opts['format'] = 'json'
    messages[0]['content'] += f"\n\nRespond only with JSON matching: {json.dumps(args['schema'])}"

res = ollama.chat(model=model, messages=messages, options=opts)
result = res['message']['content']

if args['action'] == 'json':
    try: result = json.loads(result)
    except: pass

print(json.dumps({"result": result, "latency_ms": int(res['total_duration'] / 1e6)}))
