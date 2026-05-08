/**
 * Anthropic Claude Provider
 */

const Anthropic = require('@anthropic-ai/sdk');
const { BaseProvider } = require('./base');

class ClaudeProvider extends BaseProvider {
  constructor(options = {}) {
    super(options);
    this.name = 'claude';
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    this.model = options.model || process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
    
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }
    
    this.client = new Anthropic({ apiKey: this.apiKey });
  }

  async validateKey() {
    try {
      // Minimal call to check if key is valid
      await this.client.messages.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }]
      });
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
  
  async execute(conversation, tools) {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        // Format messages
        const messages = this.formatConversation(conversation);

        // Extract system message
        const systemMessage = conversation.find(m => m.role === 'system');
        const system = systemMessage ? systemMessage.content : undefined;

        // Build request
        const request = {
          model: this.model,
          max_tokens: 4096,
          messages: messages,
        };

        if (system) {
          request.system = system;
        }

        if (tools && tools.length > 0) {
          request.tools = this.formatTools(tools);
        }

        // Send request
        const response = await this.client.messages.create(request);

        return this.parseResponse(response);
      } catch (error) {
        const isRateLimit = error.status === 429 || 
                            error.message?.includes('429') || 
                            error.message?.toLowerCase().includes('too many requests');

        if (isRateLimit && attempt < maxRetries) {
          attempt++;
          const delay = Math.pow(2, attempt) * 2000;
          console.warn(`Claude rate limited (429). Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
  }
  
  formatConversation(conversation) {
    return conversation
      .filter(msg => msg.role !== 'system')
      .map(msg => {
        if (msg.role === 'tool') {
          return {
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: msg.toolCallId,
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            }]
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
      name: tool.name,
      description: tool.description,
      input_schema: {
        type: 'object',
        properties: this.formatParameters(tool.parameters),
        required: tool.parameters.filter(p => p.required).map(p => p.name)
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
    const content = raw.content || [];
    
    return {
      content: content.filter(c => c.type === 'text').map(c => c.text).join(''),
      toolCalls: content
        .filter(c => c.type === 'tool_use')
        .map(c => ({
          id: c.id,
          name: c.name,
          arguments: c.input
        })),
      usage: raw.usage,
      provider: 'claude'
    };
  }
}

module.exports = { ClaudeProvider };

