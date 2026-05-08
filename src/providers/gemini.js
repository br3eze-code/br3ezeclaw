

 /* Google Gemini Provider
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { BaseProvider } = require('./base');

class GeminiProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.name = 'gemini';
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY;
    this.modelName = config.model || process.env.GEMINI_MODEL;
    
    if (!this.apiKey) {
      throw new Error('Gemini API key not configured');
    }
    
    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: this.modelName,
    });
  }

  async validateKey() {
    let attempt = 0;
    const maxRetries = 2;
    while (attempt <= maxRetries) {
      try {
        // Minimal call to check if key is valid
        await this.model.generateContent({
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
          generationConfig: { maxOutputTokens: 1 }
        });
        return { valid: true };
      } catch (error) {
        const isRateLimit = error.message?.includes('429') || 
                            error.message?.toLowerCase().includes('quota') ||
                            error.message?.toLowerCase().includes('too many requests');
        if (isRateLimit && attempt < maxRetries) {
          attempt++;
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          continue;
        }
        return { valid: false, error: error.message };
      }
    }
  }
  
  async execute(conversation, tools) {
    const maxRetries = 3;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        // Convert conversation to Gemini format
        const history = this.formatConversation(conversation);

        // Start chat
        const chat = this.model.startChat({
          history: history.slice(0, -1), // All but last
        });

        const lastMessage = history[history.length - 1];

        // Build generation config with tools
        const generationConfig = {};

        if (tools && tools.length > 0) {
          generationConfig.tools = this.formatTools(tools);
        }

        // Send message
        const result = await chat.sendMessage(lastMessage.parts[0].text, generationConfig);
        const response = result.response;

        return this.parseResponse(response);
      } catch (error) {
        const isRateLimit = error.message?.includes('429') || 
                            error.message?.toLowerCase().includes('quota') ||
                            error.message?.toLowerCase().includes('too many requests');

        if (isRateLimit && attempt < maxRetries) {
          attempt++;
          const delay = Math.pow(2, attempt) * 2000; // 4s, 8s, 16s
          console.warn(`Gemini rate limited (429). Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
  }
  
  formatConversation(conversation) {
    return conversation.map(msg => {
      if (msg.role === 'system') {
        return {
          role: 'user',
          parts: [{ text: `[System: ${msg.content}]` }]
        };
      }
      if (msg.role === 'assistant') {
        return {
          role: 'model',
          parts: [{ text: msg.content }]
        };
      }
      return {
        role: 'user',
        parts: [{ text: msg.content }]
      };
    });
  }
  
  formatTools(tools) {
    return [{
      functionDeclarations: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: this.formatParameters(tool.parameters),
          required: tool.parameters.filter(p => p.required).map(p => p.name)
        }
      }))
    }];
  }
  
  formatParameters(params) {
    const properties = {};
    for (const param of params) {
      properties[param.name] = {
        type: this.mapType(param.type),
        description: param.description || `${param.name} parameter`
      };
    }
    return properties;
  }
  
  mapType(type) {
    const mapping = {
      'string': 'string',
      'number': 'number',
      'boolean': 'boolean',
      'array': 'array',
      'object': 'object'
    };
    return mapping[type] || 'string';
  }
  
  parseResponse(raw) {
    const parts = raw.candidates?.[0]?.content?.parts || [];

    const textContent = parts
      .filter(p => p.text !== undefined)
      .map(p => p.text)
      .join('');

    const toolCalls = parts
      .filter(p => p.functionCall)
      .map(p => ({
        id: `gemini-${Date.now()}`,
        name: p.functionCall.name,
        arguments: p.functionCall.args || {}
      }));

    return {
      content: textContent,
      toolCalls,
      usage: raw.usageMetadata
        ? {
            input_tokens: raw.usageMetadata.promptTokenCount,
            output_tokens: raw.usageMetadata.candidatesTokenCount
          }
        : undefined,
      provider: 'gemini'
    };
  }
}

module.exports = GeminiProvider;



