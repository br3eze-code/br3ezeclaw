/**
 * OpenAI Provider
 */

const OpenAI = require('openai');
const { BaseProvider } = require('./base');

class OpenAIProvider extends BaseProvider {
  constructor(options = {}) {
    super(options);
    this.name = 'openai';
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    this.model = options.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
    
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }
    
    this.client = new OpenAI({ apiKey: this.apiKey });
  }

  async validateKey() {
    try {
      // Minimal call to check if key is valid
      await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1
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

        // Build request
        const request = {
          model: this.model,
          messages: messages,
        };

        if (tools && tools.length > 0) {
          request.tools = this.formatTools(tools);
          request.tool_choice = 'auto';
        }

        // Send request
        const response = await this.client.chat.completions.create(request);

        return this.parseResponse(response);
      } catch (error) {
        const isRateLimit = error.status === 429 || 
                            error.message?.includes('429') || 
                            error.message?.toLowerCase().includes('too many requests');

        if (isRateLimit && attempt < maxRetries) {
          attempt++;
          const delay = Math.pow(2, attempt) * 2000;
          console.warn(`OpenAI rate limited (429). Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
  }
  
  formatConversation(conversation) {
    return conversation.map(msg => {
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
        };
      }
      return {
        role: msg.role,
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
    const choice = raw.choices[0];
    const message = choice.message;
    
    return {
      content: message.content || '',
      toolCalls: message.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}')
      })),
      usage: raw.usage,
      provider: 'openai'
    };
  }
}

module.exports = { OpenAIProvider };

