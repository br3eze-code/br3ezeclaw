/**
 * Ollama Provider
 */

const { BaseProvider } = require('./base');

class OllamaProvider extends BaseProvider {
  constructor(options = {}) {
    super(options);
    this.name = 'ollama';
    this.host = options.host || process.env.OLLAMA_HOST || 'http://localhost:11434';
    this.model = options.model || process.env.OLLAMA_MODEL || 'llama3.1';
  }
  
  async execute(conversation, tools) {
    // Format messages for Ollama
    const messages = this.formatConversation(conversation);
    
    // Build request
    const request = {
      model: this.model,
      messages: messages,
      stream: false
    };
    
    // Add tools if available (Ollama supports tools in recent versions)
    if (tools && tools.length > 0) {
      request.tools = this.formatTools(tools);
    }
    
    // Send request
    const response = await fetch(`${this.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return this.parseResponse(data);
  }
  
  formatConversation(conversation) {
    return conversation.map(msg => {
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        };
      }
      return {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      };
    });
  }
  
  formatTools(tools) {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: this.formatParameters(tool.parameters),
          required: tool.parameters.filter(p => p.required).map(p => p.name)
        }
      }
    }));
  }
  
  formatParameters(params) {
    const properties = {};
    for (const param of params) {
      properties[param.name] = {
        type: param.type || 'string',
        description: param.description || `${param.name} parameter`
      };
    }
    return properties;
  }
  
  parseResponse(raw) {
    const message = raw.message || {};
    
    return {
      content: message.content || '',
      toolCalls: message.tool_calls?.map(tc => ({
        id: tc.id || this.generateId(),
        name: tc.function?.name,
        arguments: tc.function?.arguments || {}
      })),
      provider: 'ollama'
    };
  }
  
  /**
   * List available models
   */
  async listModels() {
    try {
      const response = await fetch(`${this.host}/api/tags`);
      const data = await response.json();
      return data.models || [];
    } catch (error) {
      return [];
    }
  }
  
  getInfo() {
    return {
      name: this.name,
      available: true,
      host: this.host,
      model: this.model,
      local: true
    };
  }
}

module.exports = { OllamaProvider };

