// skills/tts/index.js
const { Readable } = require('stream');
const fs = require('fs').promises;
const path = require('path');

class TTSSkill {
  constructor() {
    this.providers = new Map();
    this.cache = new Map();
    const os = require('os');
    this.cacheDir = path.join(process.cwd(), 'cache', 'tts');
  }

  async initialize() {
    await fs.mkdir(this.cacheDir, { recursive: true });
    
    // Initialize providers
    this.providers.set('edge', new EdgeTTSProvider());
    this.providers.set('openai', new OpenAITTSProvider());
    this.providers.set('elevenlabs', new ElevenLabsProvider());
    this.providers.set('local', new LocalTTSProvider());
  }

  async execute(params, context) {
    const { action, provider = 'edge', ...config } = params;
    
    const providerInstance = this.providers.get(provider);
    if (!providerInstance) {
      throw new Error(`Unknown TTS provider: ${provider}`);
    }

    switch (action) {
      case 'synthesize':
        return this.synthesize(providerInstance, config, context);
      case 'stream':
        return this.stream(providerInstance, config, context);
      case 'voices':
        return providerInstance.getVoices(config.language);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  async synthesize(provider, config, context) {
    const cacheKey = this.getCacheKey(config);
    
    // Check cache
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const cachePath = path.join(this.cacheDir, `${cacheKey}.${config.format || 'mp3'}`);
    
    try {
      // Check file cache
      await fs.access(cachePath);
      const url = `/cache/tts/${cacheKey}.${config.format || 'mp3'}`;
      const result = { success: true, url, cached: true };
      this.cache.set(cacheKey, result);
      return result;
    } catch {
      // Generate new audio
    }

    const audioBuffer = await provider.synthesize({
      text: config.text,
      voice: config.voice,
      speed: config.speed || 1.0,
      format: config.format || 'mp3',
      language: config.language || 'en'
    });

    // Save to cache
    await fs.writeFile(cachePath, audioBuffer);
    
    // Clean old cache files if needed
    await this.cleanupCache();

    const url = `/cache/tts/${cacheKey}.${config.format || 'mp3'}`;
    const result = {
      success: true,
      url,
      duration: this.estimateDuration(config.text, config.speed),
      size: audioBuffer.length,
      cached: false
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  async stream(provider, config, context) {
    const stream = await provider.stream({
      text: config.text,
      voice: config.voice,
      speed: config.speed || 1.0,
      format: config.format || 'mp3'
    });

    return {
      success: true,
      stream,
      contentType: `audio/${config.format || 'mp3'}`,
      transferEncoding: 'chunked'
    };
  }

  getCacheKey(config) {
    const crypto = require('crypto');
    const hash = crypto.createHash('md5');
    hash.update(`${config.text}|${config.voice}|${config.speed}|${config.language}`);
    return hash.digest('hex');
  }

  estimateDuration(text, speed) {
    // Average speaking rate: ~150 words per minute
    const words = text.split(/\s+/).length;
    const minutes = words / 150;
    return Math.round(minutes * 60 / speed);
  }

  async cleanupCache() {
    const files = await fs.readdir(this.cacheDir);
    if (files.length < 1000) return;

    // Remove oldest files
    const stats = await Promise.all(
      files.map(async f => ({
        name: f,
        stat: await fs.stat(path.join(this.cacheDir, f))
      }))
    );

    stats.sort((a, b) => a.stat.atime - b.stat.atime);
    const toDelete = stats.slice(0, stats.length - 500);

    for (const file of toDelete) {
      await fs.unlink(path.join(this.cacheDir, file.name));
    }
  }

  validate(params) {
    if (params.action === 'synthesize' || params.action === 'stream') {
      return !!params.text;
    }
    return true;
  }
}

// Edge TTS Provider (free, no API key needed)
class EdgeTTSProvider {
  constructor() {
    this.edge = null;
  }

  async synthesize({ text, voice = 'en-US-AriaNeural', speed = 1.0, format = 'mp3' }) {
    // Using edge-tts library (Python wrapper via child_process or native JS implementation)
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    const os = require('os');
    const tempFile = path.join(os.tmpdir(), `tts-${Date.now()}.mp3`);
    
    try {
      await execAsync(`edge-tts --voice "${voice}" --rate="${Math.round((speed - 1) * 100)}%" --text "${text.replace(/"/g, '\\"')}" --write-media "${tempFile}"`);
      const buffer = await fs.readFile(tempFile);
      await fs.unlink(tempFile);
      return buffer;
    } catch (error) {
      throw new Error(`Edge TTS failed: ${error.message}`);
    }
  }

  async getVoices(language = 'en') {
    // Return common Edge voices
    return [
      { id: 'en-US-AriaNeural', name: 'Aria', gender: 'female', language: 'en-US' },
      { id: 'en-US-GuyNeural', name: 'Guy', gender: 'male', language: 'en-US' },
      { id: 'en-GB-SoniaNeural', name: 'Sonia', gender: 'female', language: 'en-GB' },
      { id: 'en-AU-NatashaNeural', name: 'Natasha', gender: 'female', language: 'en-AU' }
    ].filter(v => v.language.startsWith(language));
  }
}

// OpenAI TTS Provider
class OpenAITTSProvider {
  async synthesize({ text, voice = 'alloy', speed = 1.0, format = 'mp3' }) {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice,
        speed,
        response_format: format
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI TTS error: ${response.statusText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async getVoices() {
    return [
      { id: 'alloy', name: 'Alloy', gender: 'neutral' },
      { id: 'echo', name: 'Echo', gender: 'male' },
      { id: 'fable', name: 'Fable', gender: 'female' },
      { id: 'onyx', name: 'Onyx', gender: 'male' },
      { id: 'nova', name: 'Nova', gender: 'female' },
      { id: 'shimmer', name: 'Shimmer', gender: 'female' }
    ];
  }
}

// ElevenLabs Provider
class ElevenLabsProvider {
  async synthesize({ text, voice = '21m00Tcm4TlvDq8ikWAM', speed = 1.0, format = 'mp3' }) {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5
        }
      })
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs error: ${response.statusText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async getVoices() {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }
    });

    const data = await response.json();
    return data.voices.map(v => ({
      id: v.voice_id,
      name: v.name,
      gender: v.labels?.gender || 'unknown',
      preview: v.preview_url
    }));
  }
}

// Local TTS using system voices (macOS say, Linux espeak, Windows sapi)
class LocalTTSProvider {
  async synthesize({ text, voice, speed = 1.0, format = 'wav' }) {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const os = require('os');
    const tempFile = path.join(os.tmpdir(), `tts-local-${Date.now()}.${format}`);
    const platform = os.platform();

    try {
      if (platform === 'darwin') {
        // macOS say command
        const rate = Math.round(speed * 200); // words per minute
        await execAsync(`say -o "${tempFile}" --rate=${rate} "${text.replace(/"/g, '\\"')}"`);
      } else if (platform === 'linux') {
        // espeak or festival
        await execAsync(`espeak "${text.replace(/"/g, '\\"')}" -w "${tempFile}" -s ${Math.round(speed * 150)}`);
      } else if (platform === 'win32') {
        // Windows PowerShell TTS
        const psScript = `
Add-Type -AssemblyName System.Speech;
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
$synth.SetOutputToWaveFile("${tempFile}");
$synth.Speak("${text.replace(/"/g, '`"')}");
$synth.Dispose();
`;
        await execAsync(`powershell -Command "${psScript}"`);
      }

      const buffer = await fs.readFile(tempFile);
      await fs.unlink(tempFile);
      return buffer;
    } catch (error) {
      throw new Error(`Local TTS failed: ${error.message}`);
    }
  }

  async getVoices() {
    const os = require('os');
    const platform = os.platform();

    if (platform === 'darwin') {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      const { stdout } = await execAsync('say -v "?"');
      return stdout.split('\n')
        .filter(line => line.trim())
        .map(line => {
          const match = line.match(/^(\w+)\s+(\w+)\s+#\s+(.+)$/);
          return match ? {
            id: match[1],
            name: match[1],
            language: match[2],
            description: match[3]
          } : null;
        })
        .filter(Boolean);
    }

    return [
      { id: 'default', name: 'System Default', language: 'en' }
    ];
  }
}

module.exports = new TTSSkill();
