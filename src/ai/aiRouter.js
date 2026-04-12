// src/ai/AIRouter.js
class AIRouter {
  constructor() {
    this.providers = {
      'anthropic': new AnthropicAdapter(),
      'openai': new OpenAIAdapter(),
      'xai': new XAIAdapter(),
      'gemini': new GeminiAdapter()  // Keep br3ezeclaw's default
    };
  }

  // Prefix-based routing like claw-code
  // "anthropic: analyze logs" vs "gemini: reboot router"
  async route(prompt, context) {
    const [prefix, ...rest] = prompt.split(':');
    const provider = this.providers[prefix.trim()] || this.defaultProvider;
    return provider.complete(rest.join(':'), context);
  }

  // Domain-specific prompt engineering
  buildSystemPrompt(domain, intent) {
    const base = `You are AgentOS v2, a domain-agnostic agent orchestrator.`;
    const domainContext = this.kernel.domains.get(domain).getContext();
    return `${base}\nCurrent domain: ${domain}\n${domainContext}`;
  }
}