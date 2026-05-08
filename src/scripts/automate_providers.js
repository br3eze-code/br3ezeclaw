'use strict';
/**
 * Automate Provider Standardization
 * Ensures all providers extend BaseProvider, include metadata, and self-register.
 */

const fs = require('fs');
const path = require('path');

const providersDir = path.join(__dirname, '../core/llm/providers');
const files = fs.readdirSync(providersDir).filter(f => f.endsWith('Provider.js') && f !== 'BaseProvider.js');

const metadataMap = {
    'GeminiProvider.js': { name: 'Google Gemini (Pro/Flash)', envKey: 'GEMINI_API_KEY', defaultModel: 'gemini-1.5-pro', tier: 1 },
    'GemmaProvider.js': { name: 'Google Gemma (Open Models)', envKey: 'GEMINI_API_KEY', defaultModel: 'gemma2-9b-it', tier: 3 },
    'OpenAIProvider.js': { name: 'OpenAI (GPT-4o)', envKey: 'OPENAI_API_KEY', defaultModel: 'gpt-4o', tier: 1 },
    'AnthropicProvider.js': { name: 'Anthropic (Claude)', envKey: 'ANTHROPIC_API_KEY', defaultModel: 'claude-3-5-sonnet-20241022', tier: 1 },
    'ClaudeProvider.js': { name: 'Anthropic (Claude)', envKey: 'ANTHROPIC_API_KEY', defaultModel: 'claude-3-5-sonnet-20241022', tier: 1 },
    'LlamaProvider.js': { name: 'Meta Llama (via Groq/Together)', envKey: 'GROQ_API_KEY', defaultModel: 'llama-3.1-70b-versatile', tier: 3 },
    'DeepSeekProvider.js': { name: 'DeepSeek (Cheap & Strong)', envKey: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-chat', tier: 2 },
    'GroqProvider.js': { name: 'Groq (Ultra Fast)', envKey: 'GROQ_API_KEY', defaultModel: 'llama3-70b-8192', tier: 2 },
    'TogetherAIProvider.js': { name: 'Together AI (Open Models)', envKey: 'TOGETHER_AI_API_KEY', defaultModel: 'mistralai/Mixtral-8x7B-Instruct-v0.1', tier: 2 },
    'OpenRouterProvider.js': { name: 'OpenRouter (Unified API)', envKey: 'OPENROUTER_API_KEY', defaultModel: 'openai/gpt-4o', tier: 1 },
    'MoonshotProvider.js': { name: 'Moonshot AI (Kimi)', envKey: 'MOONSHOT_API_KEY', defaultModel: 'moonshot-v1-8k', tier: 1 },
    'MiniMaxProvider.js': { name: 'MiniMax (abab6.5)', envKey: 'MINIMAX_API_KEY', defaultModel: 'abab6.5-chat', tier: 1 },
    'XAIProvider.js': { name: 'xAI (Grok)', envKey: 'XAI_API_KEY', defaultModel: 'grok-beta', tier: 1 },
    'OllamaProvider.js': { name: 'Ollama (Local AI)', envKey: 'OLLAMA_HOST', defaultModel: 'llama3', tier: 3 }
};

console.log(`Analyzing ${files.length} providers...`);

for (const file of files) {
    const filePath = path.join(providersDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    const meta = metadataMap[file] || { name: file.replace('Provider.js', ''), envKey: 'API_KEY', defaultModel: 'unknown', tier: 1 };
    
    let modified = false;

    // 1. Ensure BaseProvider inheritance
    if (!content.includes('extends BaseProvider')) {
        content = content.replace(/class (\w+) {/, 'class $1 extends BaseProvider {');
        if (!content.includes("require('./BaseProvider')")) {
            content = "const { BaseProvider } = require('./BaseProvider');\n" + content;
        }
        modified = true;
    }

    // 2. Insert Metadata
    const metadataStr = `
    static getMetadata() {
        return {
            name: '${meta.name}',
            envKey: '${meta.envKey}',
            defaultModel: '${meta.defaultModel}',
            tier: ${meta.tier}
        };
    }
`;

    if (!content.includes('static getMetadata()')) {
        content = content.replace(/(class \w+ extends BaseProvider {)/, `$1${metadataStr}`);
        modified = true;
    }

    // 3. Ensure self-registration
    const providerKey = file.replace('Provider.js', '').toLowerCase();
    if (!content.includes('BaseProvider.register')) {
        const className = file.replace('.js', '');
        content += `\nBaseProvider.register('${providerKey}', ${className});\n`;
        modified = true;
    }

    if (modified) {
        fs.writeFileSync(filePath, content);
        console.log(`[FIXED] ${file}`);
    } else {
        console.log(`[OK]    ${file}`);
    }
}

console.log('Automation complete.');
