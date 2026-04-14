// src/skills/codegen/index.js
// ==========================================
// CODEGEN SKILL
// Generate code from natural language using
// the AI provider configured during onboard
// ==========================================

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Load the AI config from ~/.agentos/config.json
 * Falls back to env vars so the skill also works outside onboard flow
 */
function loadAIConfig() {
  try {
    const configPath = path.join(
      require('os').homedir(), '.agentos', 'config.json'
    );
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return parsed.ai || {};
    }
  } catch (_) {}
  return {};
}

/**
 * Build a system instruction that focuses the model purely on code output
 */
function buildSystemPrompt(language, framework) {
  const lang = language && language !== 'auto' ? language : 'the most appropriate language';
  const fw   = framework ? ` using ${framework}` : '';
  return (
    `You are an expert software engineer. Generate clean, production-ready ${lang} code${fw}.\n` +
    `Output ONLY the code — no markdown fences, no explanations, no preamble.\n` +
    `Add concise inline comments where non-obvious logic exists.`
  );
}

/**
 * Call Gemini via @google/generative-ai (primary)
 */
async function callGemini(apiKey, systemPrompt, userPrompt) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: systemPrompt
  });
  const result = await model.generateContent(userPrompt);
  return result.response.text();
}

/**
 * Call OpenAI (fallback)
 */
async function callOpenAI(apiKey, systemPrompt, userPrompt) {
  const { OpenAI } = require('openai');
  const client = new OpenAI({ apiKey });
  const res = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt }
    ],
    temperature: 0.2
  });
  return res.choices[0].message.content;
}

/**
 * Call Anthropic Claude (fallback)
 */
async function callAnthropic(apiKey, systemPrompt, userPrompt) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.default({ apiKey });
  const msg = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });
  return msg.content[0].text;
}

/**
 * Try to extract language from the generated code block if unknown
 */
function detectLanguage(code, hint) {
  if (hint && hint !== 'auto') return hint;
  if (/^#!/.test(code))               return 'bash';
  if (/\bdef \w+\(/.test(code))       return 'python';
  if (/\bfunc \w+\(/.test(code))      return 'go';
  if (/\bfn \w+\(/.test(code))        return 'rust';
  if (/\bconst|let|var\b/.test(code)) return 'javascript';
  return 'text';
}

// ── Skill interface ───────────────────────────────────────────────────────────

const skill = {
  /**
   * Called once when the registry loads the skill.
   * Checks that at least one AI provider key is available.
   */
  async initialize(config) {
    const aiCfg = loadAIConfig();
    const hasKey =
      aiCfg.key ||
      process.env.GEMINI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY;

    if (!hasKey) {
      console.warn('[codegen] No AI API key found — run `agentos onboard` to configure one.');
    }
  },

  /**
   * Main execution: generate code from a natural language prompt
   *
   * @param {object} params   - { prompt, language, framework, outputFile }
   * @param {object} context  - skill execution context (injected by registry)
   * @returns {{ code, language, lines, outputFile? }}
   */
  async execute(params, context) {
    const { prompt, language = 'auto', framework, outputFile } = params;

    if (!prompt) throw new Error('`prompt` parameter is required');

    // ── Resolve AI provider ─────────────────────────────────────────────────
    const aiCfg   = loadAIConfig();
    const provider = aiCfg.provider || 'gemini';
    const apiKey  =
      aiCfg.key ||
      process.env.GEMINI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new Error(
        'No AI API key configured. Run `agentos onboard` or set GEMINI_API_KEY in your environment.'
      );
    }

    const systemPrompt = buildSystemPrompt(language, framework);
    const userPrompt   = `${prompt}`;

    // ── Call provider ────────────────────────────────────────────────────────
    let code;
    switch (provider) {
      case 'openai':
        code = await callOpenAI(apiKey, systemPrompt, userPrompt);
        break;
      case 'anthropic':
        code = await callAnthropic(apiKey, systemPrompt, userPrompt);
        break;
      case 'gemini':
      default:
        code = await callGemini(apiKey, systemPrompt, userPrompt);
    }

    // Strip any stray markdown fences the model might have added
    code = code.replace(/^```[\w]*\n?|```$/gm, '').trim();

    const detectedLang = detectLanguage(code, language);
    const lines        = code.split('\n').length;

    // ── Optional: write to file ──────────────────────────────────────────────
    if (outputFile) {
      const absPath = path.resolve(outputFile);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, code, 'utf8');
    }

    return {
      code,
      language: detectedLang,
      lines,
      provider,
      ...(outputFile ? { outputFile: path.resolve(outputFile) } : {})
    };
  },

  async destroy() {}
};

module.exports = skill;
