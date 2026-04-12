

 * Google Gemini Provider
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { BaseProvider } = require('./base');

class GeminiProvider extends BaseProvider {
  constructor(options = {}) {
    super(options);
    this.name = 'gemini';
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    this.modelName = options.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20';
    
    if (!this.apiKey) {
      throw new Error('Gemini API key not configured');
    }
    
    this.genAI = new GoogleGenerativeAI(this.apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: this.modelName,
    });
  }
  
  async execute(conversation, tools) {
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
    return {
      candidates: [{
        content: {
          parts: raw.candidates?.[0]?.content?.parts || [{ text: '' }]
        }
      }]
    };
  }
}

module.exports = { GeminiProvider };



