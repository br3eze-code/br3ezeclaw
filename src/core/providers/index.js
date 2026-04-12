// src/core/providers/index.js
class ProviderManager {
  constructor(config) {
    this.providers = new Map();
    this.primary = config.primary;
    this.fallbacks = config.fallbacks || [];
    
    // Register multiple backends
    this.register('gemini', new GeminiProvider(config.gemini));
    this.register('claude', new ClaudeProvider(config.anthropic));
    this.register('openai', new OpenAIProvider(config.openai));
    this.register('ollama', new OllamaProvider(config.ollama));
  }
  
  async execute(prompt, tools) {
    // Try primary first
    try {
      return await this.providers.get(this.primary).execute(prompt, tools);
    } catch (err) {
      // Exponential backoff through fallbacks
      for (const fallback of this.fallbacks) {
        try {
          return await this.providers.get(fallback).execute(prompt, tools);
        } catch (e) {
          continue;
        }
      }
      throw new Error('All providers failed');
    }
  }
}

// Normalize all provider outputs to canonical format
class BaseProvider {
  normalizeToolCall(raw) {
    return {
      name: raw.function?.name || raw.tool,
      arguments: raw.function?.arguments || raw.parameters,
      id: raw.id || generateId()
    };
  }
}
