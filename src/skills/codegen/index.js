const { BaseDriver } = require('../base.js');
const { logger } = require('../../core/logger');

class CodegenSkill extends BaseDriver {
  static id = 'codegen';
  static name = 'MikroTik AI Codegen';
  static description = 'Generate MikroTik RouterOS .rsc code from natural language using Gemini';

  constructor(config, logger) {
    super(config, logger);
  }

  static getTools() {
    return {
      'codegen.generate': {
        risk: 'medium',
        description: 'Generate MikroTik RouterOS configuration code from a text description',
        parameters: {
          type: 'object',
          properties: {
            prompt: { 
              type: 'string', 
              description: "What to configure. E.g. 'block youtube', 'limit guest bandwidth to 1M'" 
            }
          },
          required: ['prompt']
        }
      }
    };
  }

  async execute(toolName, args, ctx) {
    const { prompt } = args;
    const agent = ctx.agent || global.agent;
    const mikrotik = agent?.mikrotik || global.mikrotik;
    const gemini = agent?.gemini || global.gemini;

    if (!gemini) throw new Error('AI provider (Gemini) not initialized');

    logger.info(`[CodegenSkill] Generating code for: ${prompt}`);

    // Get context from router if possible
    let version = '7.x';
    let board = 'MikroTik';
    if (mikrotik?.state?.isConnected) {
        try {
            const stats = await mikrotik.executeTool('system.stats');
            version = stats.version || version;
            board = stats.board || board;
        } catch (e) {
            logger.warn('[CodegenSkill] Failed to fetch router context, using defaults');
        }
    }

    const systemPrompt = `You are a MikroTik RouterOS ${version} expert. 
Output ONLY valid .rsc code. No explanations, no markdown, no comments.
Use RouterOS v7 syntax. Be precise with paths.
Target Hardware: ${board}`;

    try {
        const response = await gemini.generate({
            model: "gemini-2.5-flash",
            system: systemPrompt,
            prompt: `Generate RouterOS code for: ${prompt}`
        });

        const code = response.text.trim();
        
        if (!code.startsWith('/')) {
            throw new Error('Generated code is not a valid RouterOS command sequence');
        }

        return {
            success: true,
            prompt,
            code,
            warning: "Review the code before applying to production routers."
        };
    } catch (err) {
        logger.error(`[CodegenSkill] AI generation failed: ${err.message}`);
        throw err;
    }
  }
}

module.exports = CodegenSkill;
