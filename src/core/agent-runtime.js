/**
 * Agent Runtime
 * Orchestrates tool execution, memory management, and provider calls
 * Implements the OpenClaw execution loop
 */

const { Logger } = require('../utils/logger');

class AgentRuntime {
  constructor(options) {
    this.toolRegistry = options.toolRegistry;
    this.sessionManager = options.sessionManager;
    this.memoryStore = options.memoryStore;
    this.providerManager = options.providerManager;
    this.safetyEnvelope = options.safetyEnvelope;
    
    this.logger = new Logger('AgentRuntime');
    this.maxIterations = options.maxIterations || 10;
  }
  
  /**
   * Main execution loop
   */
  async execute(frame) {
    const sessionId = this.sessionManager.getSessionId(frame);
    
    this.logger.debug(`Executing for session: ${sessionId}`);
    
    // Load session history
    const history = await this.sessionManager.load(sessionId);
    
    // Get capability manifest
    const manifest = this.toolRegistry.getManifest();
    
    // Build system prompt with capabilities
    const systemPrompt = this.buildSystemPrompt(manifest);
    
    // Prepare conversation
    const conversation = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: frame.content }
    ];
    
    // Execution loop with tool calling
    let iteration = 0;
    let finalResponse = null;
    
    while (iteration < this.maxIterations) {
      iteration++;
      
      // Call provider
      const response = await this.providerManager.execute(conversation, manifest.tools);
      
      // Check for tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Add assistant message with tool calls
        conversation.push({
          role: 'assistant',
          content: response.content || '',
          toolCalls: response.toolCalls
        });
        
        // Execute tools
        const toolResults = await this.executeTools(response.toolCalls, frame);
        
        // Add tool results to conversation
        for (const result of toolResults) {
          conversation.push({
            role: 'tool',
            toolCallId: result.toolCallId,
            content: JSON.stringify(result.result)
          });
        }
        
        // Continue loop for final response
        continue;
      }
      
      // No tool calls - we have final response
      finalResponse = response.content;
      conversation.push({
        role: 'assistant',
        content: finalResponse
      });
      break;
    }
    
    // Save updated session
    await this.sessionManager.save(sessionId, conversation.slice(-20)); // Keep last 20 messages
    
    // Persist to memory store for long-term recall
    await this.memoryStore.append(sessionId, {
      timestamp: Date.now(),
      input: frame.content,
      output: finalResponse,
      toolsUsed: conversation.filter(m => m.role === 'tool').length
    });
    
    return {
      response: finalResponse,
      sessionId,
      iterations: iteration,
      toolsUsed: conversation.filter(m => m.role === 'tool').map(m => m.toolCallId)
    };
  }
  
  /**
   * Execute a single tool directly (for CLI/commands)
   */
  async executeTool(toolName, params, options = {}) {
    const tool = this.toolRegistry.getTool(toolName);
    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }
    
    // Validate parameters
    const validation = this.validateParams(tool.schema.parameters, params);
    if (!validation.valid) {
      throw new Error(`Parameter validation failed: ${validation.error}`);
    }
    
    // Check safety envelope
    if (!this.safetyEnvelope.checkToolExecution(toolName, params)) {
      throw new Error(`Tool execution blocked by safety envelope: ${toolName}`);
    }
    
    // Execute
    this.logger.info(`Executing tool: ${toolName}`, params);
    return await tool.handler(params, options);
  }
  
  /**
   * Execute multiple tool calls
   */
  async executeTools(toolCalls, frame) {
    const results = [];
    
    for (const call of toolCalls) {
      try {
        const tool = this.toolRegistry.getTool(call.name);
        if (!tool) {
          results.push({
            toolCallId: call.id,
            result: { error: `Tool not found: ${call.name}` }
          });
          continue;
        }
        
        // Validate
        const validation = this.validateParams(tool.schema.parameters, call.arguments);
        if (!validation.valid) {
          results.push({
            toolCallId: call.id,
            result: { error: validation.error }
          });
          continue;
        }
        
        // Safety check
        if (!this.safetyEnvelope.checkToolExecution(call.name, call.arguments)) {
          results.push({
            toolCallId: call.id,
            result: { error: 'Blocked by safety envelope' }
          });
          continue;
        }
        
        // Execute with context
        const result = await tool.handler(call.arguments, {
          sender: frame.sender,
          channel: frame.channel,
          sessionId: this.sessionManager.getSessionId(frame)
        });
        
        results.push({
          toolCallId: call.id,
          result
        });
        
      } catch (error) {
        this.logger.error(`Tool execution error (${call.name}):`, error);
        results.push({
          toolCallId: call.id,
          result: { error: error.message }
        });
      }
    }
    
    return results;
  }
  
  /**
   * Build system prompt with capability manifest
   */
  buildSystemPrompt(manifest) {
    const toolDescriptions = manifest.tools.map(tool => {
      const params = tool.parameters.map(p => 
        `${p.name}${p.required ? '' : '?'}: ${p.type}`
      ).join(', ');
      return `- ${tool.name}(${params}): ${tool.description}`;
    }).join('\\n');
    
    return `You are AgentOS, an AI assistant that helps manage systems through available tools.

Available tools:
${toolDescriptions}

When you need to use a tool, respond with a tool call. Otherwise, respond naturally.
Be concise and helpful. If a tool execution fails, explain the error to the user.`;
  }
  
  /**
   * Validate parameters against schema
   */
  validateParams(schema, params) {
    for (const param of schema) {
      if (param.required && !(param.name in params)) {
        return { valid: false, error: `Missing required parameter: ${param.name}` };
      }
      
      if (param.name in params) {
        const value = params[param.name];
        const expectedType = param.type;
        
        if (expectedType === 'string' && typeof value !== 'string') {
          return { valid: false, error: `Parameter ${param.name} must be a string` };
        }
        if (expectedType === 'number' && typeof value !== 'number') {
          return { valid: false, error: `Parameter ${param.name} must be a number` };
        }
        if (expectedType === 'boolean' && typeof value !== 'boolean') {
          return { valid: false, error: `Parameter ${param.name} must be a boolean` };
        }
      }
    }
    
    return { valid: true };
  }
}

module.exports = { AgentRuntime };

