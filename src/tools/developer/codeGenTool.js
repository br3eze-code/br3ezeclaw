// src/tools/developer/codeGenTool.js
class CodeGenTool extends BaseTool {
  constructor() {
    super({
      name: 'codegen',
      description: 'Generate code from natural language',
      autonomyLevel: 'supervised'
    });
  }
  
  async execute(params, context) {
    const { prompt, language, framework } = params;
    
    // Use Gemini for code generation
    const code = await this.llm.generate({
      prompt: `Generate ${language} code using ${framework}: ${prompt}`,
      systemPrompt: this.getSystemPrompt(language)
    });
    
    // Apply policy checks
    if (this.policy.requiresApproval('codegen', code)) {
      await context.requestApproval(code);
    }
    
    // Write to filesystem or return
    return {
      code,
      files: this.parseFileStructure(code),
      tests: this.generateTests(code)
    };
  }
}
