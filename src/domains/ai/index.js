// src/domains/ai/index.js
const BaseDomain = require('../BaseDomain');
const { ClaudeProvider } = require('../../providers/claude');

class AIDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'ai';
    
    this.registerTool({
      name: 'status',
      description: 'Check status and validity of configured AI providers',
      execute: async () => {
        const providers = [];
        const { OpenAIProvider } = require('../../providers/openai');
        const GeminiProvider = require('../../providers/gemini');
        const { OllamaProvider } = require('../../providers/ollama');

        // Helper to check provider
        const checkProvider = async (name, ProviderClass, envKey) => {
          if (process.env[envKey] || name === 'Ollama') {
            try {
              const provider = new ProviderClass();
              const result = await provider.validateKey();
              return { name, configured: true, valid: result.valid, error: result.error };
            } catch (e) {
              return { name, configured: true, valid: false, error: e.message };
            }
          }
          return { name, configured: false };
        };

        providers.push(await checkProvider('Anthropic', ClaudeProvider, 'ANTHROPIC_API_KEY'));
        providers.push(await checkProvider('OpenAI', OpenAIProvider, 'OPENAI_API_KEY'));
        providers.push(await checkProvider('Gemini', GeminiProvider, 'GEMINI_API_KEY'));
        providers.push(await checkProvider('Ollama', OllamaProvider, 'OLLAMA_MODEL'));

        return providers;
      }
    });

    this.registerTool({
      name: 'verify',
      description: 'Verify if a specific AI provider key is working',
      execute: async (provider = 'anthropic') => {
        const p = provider.toLowerCase();
        if (p === 'anthropic') {
           const claude = new ClaudeProvider();
           return await claude.validateKey();
        } else if (p === 'openai') {
           const { OpenAIProvider } = require('../../providers/openai');
           const openai = new OpenAIProvider();
           return await openai.validateKey();
        } else if (p === 'gemini') {
           const GeminiProvider = require('../../providers/gemini');
           const gemini = new GeminiProvider();
           return await gemini.validateKey();
        } else if (p === 'ollama') {
           const { OllamaProvider } = require('../../providers/ollama');
           const ollama = new OllamaProvider();
           return await ollama.validateKey();
        }
        return { success: false, error: `Provider ${provider} not supported for verification yet.` };
      }
    });
  }
}

module.exports = AIDomain;
