#!/usr/bin/env node
/**
 * AgentOS Autonomous Audit Orchestrator — Enhanced
 *
 * API features used:
 *   - Extended Thinking  → PHASE 2 (security), PHASE 3 (bugs), PHASE 5 (patch)
 *   - Tool Use           → PHASE 4 (research) with web_search tool
 *   - Batch API          → PHASE 2 + PHASE 3 run in parallel after PHASE 1
 *   - Streaming          → PHASE 6 (report) streamed to disk progressively
 *   - Multiple Skills    → audit.skill.md / security.skill.md / bugfix.skill.md /
 *                          research.skill.md / patch.skill.md
 *
 * Run:  node .github/scripts/run-skill-chain.js
 * Env:  ANTHROPIC_API_KEY (required)
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Config ───────────────────────────────────────────────────────────────────
const SKILLS_DIR  = path.resolve('.github/skills');
const REPORT_DIR  = path.resolve('docs/audit');
const TODAY       = new Date().toISOString().slice(0, 10);
const REPORT_FILE = path.join(REPORT_DIR, `${TODAY}.md`);

const MODELS = {
  standard:  'claude-sonnet-4-20250514',  // standard phases
  thinking:  'claude-sonnet-4-20250514',  // extended thinking (same model, thinking enabled)
};

const THINKING_BUDGETS = {
  security: 8000,   // deep threat modelling
  bugs:     6000,   // careful async/RouterOS analysis
  patch:    10000,  // careful before touching production code
};

const CHAR_LIMIT = 140_000;
const FILE_CAP   = 12_000;

// ── Logging ──────────────────────────────────────────────────────────────────
const log  = msg  => console.log(`[audit] ${msg}`);
const die  = msg  => { console.error(`[audit:FATAL] ${msg}`); process.exit(1); };
const time = label => { const t = Date.now(); return () => `${label} (${Date.now()-t}ms)`; };

// ── Skill loader ─────────────────────────────────────────────────────────────
function loadSkill(filename) {
  const p = path.join(SKILLS_DIR, filename);
  if (!fs.existsSync(p)) die(`Skill not found: ${p}`);
  return fs.readFileSync(p, 'utf8');
}

function parsePhase(skillContent, phaseLabel) {
  const rx    = new RegExp(`^## ${phaseLabel}$`, 'm');
  const match = rx.exec(skillContent);
  if (!match) die(`Phase "${phaseLabel}" not found in skill`);
  const start = match.index + match[0].length;
  // next ## heading ends the phase
  const nextHeading = /^## /m.exec(skillContent.slice(start));
  const end = nextHeading ? start + nextHeading.index : skillContent.length;
  return skillContent.slice(start, end).replace(/^> .+\n/gm, '').trim();
}

// ── Source collector ─────────────────────────────────────────────────────────
function collectSourceFiles() {
  const rootFiles = [
    'agentos.js', 'agentos.mjs', 'package.json', 'SKILL.md', 'SPEC.md',
    'START_HERE.md', 'firestore.rules', 'firestore.indexes.json', 'firebase.json',
    'agentos-sentinel.rsc', 'mikro.rsc', 'deploy.sh', 'deploy.yml',
    'agentos.yaml', 'docker-compose.yml', 'config.xml', 'jsconfig.json',
    'tsconfig.json', 'flake.nix', 'install.sh', 'migration.js',
    'test-firebase.js', 'test-mikrotik.js', 'test.br3eze.js', '.env.example',
    'scripts/security-check.js', 'scripts/postinstall.js', 'scripts/preuninstall.js',
  ];
  const sourceDirs = [
    'src', 'adapters', 'agents', 'tools', 'services', 'server',
    'skills', 'bin', 'config', 'scripts', 'tests', 'typings',
    'www', 'apps/shared/AgentOSkit', 'vscode-extension/src',
    'custom-plugins/cordova-plugin-aicore', 'test-planner',
  ];
  const allowedExts = new Set([
    '.js', '.mjs', '.ts', '.tsx', '.json', '.md', '.yaml', '.yml',
    '.rsc', '.sh', '.ps1', '.nix', '.html', '.css', '.xml', '.rules',
  ]);
  const skipDirs = new Set([
    'node_modules', '.git', 'dist', 'build', 'coverage',
    '.cordova', 'platforms', 'plugins',
  ]);

  const files = {};
  let totalChars = 0;

  const addFile = fp => {
    if (totalChars >= CHAR_LIMIT || !fs.existsSync(fp)) return;
    try {
      if (fs.statSync(fp).size > 200_000) return;
      const c = fs.readFileSync(fp, 'utf8').slice(0, FILE_CAP);
      files[fp] = c;
      totalChars += c.length;
    } catch {}
  };

  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.') || skipDirs.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (allowedExts.has(path.extname(e.name))) addFile(full);
      }
    } catch {}
  };

  for (const f of rootFiles) addFile(f);
  for (const d of sourceDirs) walk(d);

  log(`Source: ${Object.keys(files).length} files, ${Math.round(totalChars/1000)}k chars`);
  return files;
}

// ── API helpers ──────────────────────────────────────────────────────────────

/** Standard API call */
async function callClaude(system, user, opts = {}) {
  const body = {
    model:      opts.model ?? MODELS.standard,
    max_tokens: opts.maxTokens ?? 8192,
    system,
    messages: [{ role: 'user', content: user }],
  };
  if (opts.tools) body.tools = opts.tools;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const b = await res.text();
    throw new Error(`API ${res.status}: ${b.slice(0, 400)}`);
  }
  const data = await res.json();

  // Handle tool use loop (for web_search)
  if (data.stop_reason === 'tool_use' && opts.tools) {
    return handleToolUse(data, system, user, opts);
  }

  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

/** Extended thinking API call */
async function callClaudeThinking(system, user, thinkingBudget) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta':    'interleaved-thinking-2025-05-14',
    },
    body: JSON.stringify({
      model:      MODELS.thinking,
      max_tokens: thinkingBudget + 8192,
      thinking: {
        type:          'enabled',
        budget_tokens: thinkingBudget,
      },
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const b = await res.text();
    // Fallback to standard if thinking not available on this model tier
    log(`WARN: Extended thinking unavailable (${res.status}), falling back to standard`);
    return callClaude(system, user, { maxTokens: 8192 });
  }

  const data = await res.json();
  // Return only text blocks (skip thinking blocks)
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

/** Streaming API call — writes chunks to file progressively */
async function callClaudeStreaming(system, user, outputPath) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      MODELS.standard,
      max_tokens: 8192,
      stream:     true,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!res.ok) {
    const b = await res.text();
    throw new Error(`Streaming API ${res.status}: ${b.slice(0, 400)}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const stream = fs.createWriteStream(outputPath, { encoding: 'utf8' });

  let full = '';
  const decoder = new TextDecoder();
  const reader  = res.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        const ev = JSON.parse(data);
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          const text = ev.delta.text;
          full  += text;
          stream.write(text);
        }
      } catch {}
    }
  }

  stream.end();
  log(`Streaming complete → ${outputPath} (${Math.round(full.length/1000)}k chars)`);
  return full;
}

/** Tool use agentic loop — handles web_search for PHASE 4 */
async function handleToolUse(data, system, _originalUser, opts) {
  const messages = [
    { role: 'user',      content: _originalUser },
    { role: 'assistant', content: data.content  },
  ];

  let iterations = 0;
  const MAX_ITER = 8;

  while (data.stop_reason === 'tool_use' && iterations < MAX_ITER) {
    iterations++;
    const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
    const toolResults   = [];

    for (const tu of toolUseBlocks) {
      log(`  Tool call: ${tu.name}("${JSON.stringify(tu.input).slice(0,60)}")`);
      // web_search is executed by the API — we just pass the result back
      toolResults.push({
        type:        'tool_result',
        tool_use_id: tu.id,
        content:     `[Tool ${tu.name} executed by API — results embedded in next turn]`,
      });
    }

    messages.push({ role: 'user', content: toolResults });

    const res2 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      MODELS.standard,
        max_tokens: opts.maxTokens ?? 8192,
        system,
        messages,
        tools: opts.tools,
      }),
    });

    if (!res2.ok) break;
    data = await res2.json();
    messages.push({ role: 'assistant', content: data.content });
  }

  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

/** Batch API — submit multiple requests, poll until complete */
async function runBatch(requests) {
  log(`Submitting batch of ${requests.length} requests...`);

  const res = await fetch('https://api.anthropic.com/v1/messages/batches', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta':    'message-batches-2024-09-24',
    },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) {
    const b = await res.text();
    log(`WARN: Batch API failed (${res.status}): ${b.slice(0,200)} — falling back to sequential`);
    return null;  // caller handles fallback
  }

  const batch = await res.json();
  const batchId = batch.id;
  log(`Batch submitted: ${batchId}`);

  // Poll until complete
  let attempts = 0;
  while (attempts < 60) {
    await new Promise(r => setTimeout(r, 10_000));  // 10s interval
    attempts++;

    const poll = await fetch(`https://api.anthropic.com/v1/messages/batches/${batchId}`, {
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'message-batches-2024-09-24',
      },
    });

    const status = await poll.json();
    const counts = status.request_counts;
    log(`  Batch poll [${attempts}]: processing=${counts.processing} succeeded=${counts.succeeded} errored=${counts.errored}`);

    if (status.processing_status === 'ended') {
      // Fetch results
      const resultsRes = await fetch(`https://api.anthropic.com/v1/messages/batches/${batchId}/results`, {
        headers: {
          'x-api-key':         process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta':    'message-batches-2024-09-24',
        },
      });
      const text    = await resultsRes.text();
      const lines   = text.trim().split('\n').filter(Boolean);
      const results = {};
      for (const line of lines) {
        const r = JSON.parse(line);
        if (r.result?.type === 'succeeded') {
          results[r.custom_id] = r.result.message.content
            .filter(b => b.type === 'text').map(b => b.text).join('');
        } else {
          log(`  WARN batch item ${r.custom_id} failed: ${JSON.stringify(r.result)}`);
          results[r.custom_id] = null;
        }
      }
      log(`Batch complete: ${Object.keys(results).length} results`);
      return results;
    }
  }

  log('WARN: Batch timed out after 10 minutes — falling back to sequential');
  return null;
}

// ── JSON parser ───────────────────────────────────────────────────────────────
function parseJSON(raw, label) {
  if (!raw) { log(`WARN ${label}: null response`); return null; }
  const clean = raw
    .replace(/^```json\s*/m, '').replace(/^```\s*/m, '').replace(/```$/m, '').trim();
  try   { return JSON.parse(clean); }
  catch (e) {
    log(`WARN ${label}: JSON parse failed — ${e.message}`);
    log(`Snippet: ${clean.slice(0, 300)}`);
    return null;
  }
}

// ── Patch applicator ─────────────────────────────────────────────────────────
function applyPatch(patch) {
  if (!fs.existsSync(patch.file)) {
    log(`  SKIP ${patch.finding_id}: file not found`); return false;
  }
  let src = fs.readFileSync(patch.file, 'utf8');
  const n = src.split(patch.search).length - 1;
  if (n === 0) { log(`  SKIP ${patch.finding_id}: search not found in ${patch.file}`); return false; }
  if (n  > 1)  { log(`  SKIP ${patch.finding_id}: not unique (${n} hits)`);            return false; }
  fs.writeFileSync(patch.file, src.replace(patch.search, patch.replace), 'utf8');
  log(`  PATCHED ${patch.finding_id}: ${patch.file} — ${patch.description}`);
  return true;
}

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM = `You are an autonomous AI agent performing a weekly security and quality audit of the AgentOS repository for Brighton Mzacana / Br3eze Africa.
AgentOS: AI-powered MikroTik community WiFi billing platform for Zimbabwe.
Stack: Node.js CJS ≥22, Firebase/Firestore, routeros-client v1.1.1, Telegram, WhatsApp (Baileys optional), Mastercard A2A, Gemini 2.5/Anthropic/OpenAI ReAct agents.
Sub-projects: apps/shared/AgentOSkit, vscode-extension, custom-plugins/cordova-plugin-aicore, www (captive portal), scripts/.
Follow each instruction exactly. Output only what is specified.`;

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) die('ANTHROPIC_API_KEY not set');

  log(`=== AgentOS Autonomous Audit ===`);
  log(`Date: ${TODAY} | Models: ${MODELS.standard} (standard) + extended thinking`);

  // Load all skill files
  const skills = {
    audit:    loadSkill('audit.skill.md'),
    security: loadSkill('security.skill.md'),
    bugfix:   loadSkill('bugfix.skill.md'),
    research: loadSkill('research.skill.md'),
    patch:    loadSkill('patch.skill.md'),
  };
  log(`Skills loaded: ${Object.keys(skills).join(', ')}`);

  // Collect source
  const source   = collectSourceFiles();
  const srcBlock = Object.entries(source)
    .map(([p, c]) => `### FILE: ${p}\n\`\`\`\n${c}\n\`\`\``)
    .join('\n\n');

  const ctx = {};

  // ── PHASE 1: RECON (standard) ───────────────────────────────
  log('\n[PHASE 1: RECON — standard]');
  const t1 = time('PHASE 1');
  const p1prompt = parsePhase(skills.audit, 'PHASE 1');
  const r1 = await callClaude(SYSTEM,
    `${p1prompt}\n\n<codebase>\n${srcBlock}\n</codebase>`);
  ctx.recon = parseJSON(r1, 'PHASE 1');
  log(t1());
  log(`Files mapped: ${Object.keys(ctx.recon?.file_map ?? {}).length}`);
  log(`Version drift: ${ctx.recon?.version?.drift ? '⚠️  YES' : 'no'}`);
  log(`Wildcard deps: ${(ctx.recon?.wildcard_deps ?? []).join(', ') || 'none'}`);

  // ── PHASES 2+3: PARALLEL via Batch API ─────────────────────
  log('\n[PHASE 2+3: SECURITY + BUGS — Batch API with extended thinking]');
  const t23 = time('PHASE 2+3');

  const secPrompt = parsePhase(skills.security, 'SECURITY_AUDIT');
  const bugPrompt = parsePhase(skills.bugfix,   'BUG_HUNT');

  const batchRequests = [
    {
      custom_id: 'security',
      params: {
        model:      MODELS.thinking,
        max_tokens: THINKING_BUDGETS.security + 8192,
        thinking:   { type: 'enabled', budget_tokens: THINKING_BUDGETS.security },
        system:     SYSTEM,
        messages:   [{
          role: 'user',
          content: `${secPrompt}\n\n<recon>${JSON.stringify(ctx.recon)}</recon>\n<codebase>${srcBlock}</codebase>`,
        }],
      },
    },
    {
      custom_id: 'bugs',
      params: {
        model:      MODELS.thinking,
        max_tokens: THINKING_BUDGETS.bugs + 8192,
        thinking:   { type: 'enabled', budget_tokens: THINKING_BUDGETS.bugs },
        system:     SYSTEM,
        messages:   [{
          role: 'user',
          content: `${bugPrompt}\n\n<recon>${JSON.stringify(ctx.recon)}</recon>\n<codebase>${srcBlock}</codebase>`,
        }],
      },
    },
  ];

  const batchResults = await runBatch(batchRequests);

  if (batchResults) {
    // Batch succeeded
    ctx.security = parseJSON(batchResults['security'], 'PHASE 2 (batch)');
    ctx.bugs     = parseJSON(batchResults['bugs'],     'PHASE 3 (batch)');
  } else {
    // Fallback: sequential with extended thinking
    log('Fallback: running PHASE 2 + 3 sequentially with extended thinking...');

    const r2 = await callClaudeThinking(SYSTEM,
      `${secPrompt}\n\n<recon>${JSON.stringify(ctx.recon)}</recon>\n<codebase>${srcBlock}</codebase>`,
      THINKING_BUDGETS.security);
    ctx.security = parseJSON(r2, 'PHASE 2');

    const r3 = await callClaudeThinking(SYSTEM,
      `${bugPrompt}\n\n<recon>${JSON.stringify(ctx.recon)}</recon>\n<security>${JSON.stringify(ctx.security)}</security>\n<codebase>${srcBlock}</codebase>`,
      THINKING_BUDGETS.bugs);
    ctx.bugs = parseJSON(r3, 'PHASE 3');
  }

  log(t23());
  const ss = ctx.security?.summary ?? {};
  const bs = ctx.bugs?.summary     ?? {};
  log(`Security: CRITICAL=${ss.CRITICAL} HIGH=${ss.HIGH} MEDIUM=${ss.MEDIUM} LOW=${ss.LOW}`);
  log(`Bugs:     CRASH=${bs.CRASH}     HIGH=${bs.HIGH} MEDIUM=${bs.MEDIUM} LOW=${bs.LOW}`);

  // ── PHASE 4: RESEARCH with web_search tool ─────────────────
  log('\n[PHASE 4: RESEARCH — tool use + web_search]');
  const t4 = time('PHASE 4');
  const resPrompt = parsePhase(skills.research, 'RESEARCH');

  const webSearchTool = {
    type: 'web_search_20250305',
    name: 'web_search',
  };

  const r4 = await callClaude(SYSTEM,
    `${resPrompt}\n\n<recon>${JSON.stringify(ctx.recon)}</recon>\n<security>${JSON.stringify(ctx.security)}</security>\n<bugs>${JSON.stringify(ctx.bugs)}</bugs>`,
    { tools: [webSearchTool], maxTokens: 8192 }
  );
  ctx.research = parseJSON(r4, 'PHASE 4');
  log(t4());
  log(`Research items: ${ctx.research?.research?.length ?? 0}`);

  // ── PHASE 5: PATCH with extended thinking ──────────────────
  log('\n[PHASE 5: PATCH — extended thinking]');
  const t5 = time('PHASE 5');
  const patchPrompt = parsePhase(skills.patch, 'PATCH_GENERATION');

  const r5 = await callClaudeThinking(SYSTEM,
    `${patchPrompt}\n\n<security>${JSON.stringify(ctx.security)}</security>\n<bugs>${JSON.stringify(ctx.bugs)}</bugs>\n<research>${JSON.stringify(ctx.research)}</research>\n<codebase>${srcBlock}</codebase>`,
    THINKING_BUDGETS.patch
  );
  ctx.patches = parseJSON(r5, 'PHASE 5') ?? { patches: [], skipped: [] };

  const applied = [];
  const failed  = [];
  // Sort by priority before applying
  const sorted = (ctx.patches.patches ?? []).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  for (const patch of sorted) {
    (applyPatch(patch) ? applied : failed).push(patch.finding_id);
  }
  ctx.patches._applied = applied;
  ctx.patches._failed  = failed;
  log(t5());
  log(`Patches applied: [${applied.join(', ') || 'none'}]`);
  log(`Patches skipped: [${[...failed, ...(ctx.patches.skipped?.map(s=>s.finding_id)??[])].join(', ') || 'none'}]`);

  // ── PHASE 6: REPORT — streaming to disk ───────────────────
  log('\n[PHASE 6: REPORT — streaming]');
  const t6 = time('PHASE 6');
  const reportPrompt = parsePhase(skills.audit, 'PHASE 6')
    .replace('{{ DATE }}', TODAY);

  ctx.report = await callClaudeStreaming(SYSTEM,
    `${reportPrompt}\n\n<recon>${JSON.stringify(ctx.recon)}</recon>\n<security>${JSON.stringify(ctx.security)}</security>\n<bugs>${JSON.stringify(ctx.bugs)}</bugs>\n<research>${JSON.stringify(ctx.research)}</research>\n<patches>${JSON.stringify(ctx.patches)}</patches>`,
    REPORT_FILE
  );
  log(t6());

  // ── Summary artifact ──────────────────────────────────────
  const summary = {
    date:            TODAY,
    model:           MODELS.standard,
    features_used:   ['extended_thinking', 'batch_api', 'tool_use_web_search', 'streaming'],
    source_files:    Object.keys(source).length,
    security:        ctx.security?.summary  ?? {},
    bugs:            ctx.bugs?.summary      ?? {},
    research_count:  ctx.research?.research?.length ?? 0,
    patches_applied: applied,
    patches_skipped: failed,
    version_drift:   ctx.recon?.version?.drift ?? false,
    wildcard_deps:   ctx.recon?.wildcard_deps  ?? [],
    report:          REPORT_FILE,
  };

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORT_DIR, 'latest.json'),
    JSON.stringify(summary, null, 2),
    'utf8'
  );

  log('\n=== Done ===');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(e => die(e.stack ?? e.message));
