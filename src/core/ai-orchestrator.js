'use strict';
/**
 * AIOrchestrator — Multi-purpose Gemini Enterprise AI Router
 *
 * Bridges AgentOS tool requests to the Google Gemini Enterprise API
 * (Vertex AI Generative AI) with:
 *   - Structured function-calling (tools integration)
 *   - Session-aware conversation history
 *   - Automatic routing to specialized A2A sub-agents
 *   - Fallback to Gemini Developer API (GEMINI_API_KEY) when Vertex is not configured
 */

const https = require('https');
const { EventEmitter } = require('events');

// ─── Vertex AI Generative Language SDK (optional) ─────────────────────────────
let VertexAI;
try {
    ({ VertexAI } = require('@google-cloud/vertexai'));
} catch { /* will fall back to REST */ }

// ─── Google Auth (optional) ────────────────────────────────────────────────────
let GoogleAuth;
try {
    ({ GoogleAuth } = require('google-auth-library'));
} catch { /* will fall back to API key */ }

class AIOrchestrator extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            // Vertex AI (enterprise)
            project:    config.project   || process.env.GOOGLE_CLOUD_PROJECT,
            location:   config.location  || process.env.GEMINI_LOCATION || 'us-central1',
            model:      config.model     || process.env.GEMINI_MODEL    || 'gemini-2.0-flash-001',
            // Fallback (developer API)
            apiKey:     config.apiKey    || process.env.GEMINI_API_KEY,
            // Behaviour
            temperature:     config.temperature     ?? 0.2,
            maxOutputTokens: config.maxOutputTokens ?? 8192,
            systemPrompt:    config.systemPrompt    || DEFAULT_SYSTEM_PROMPT,
            // Routing
            a2aAdapter:   config.a2aAdapter  || null,   // injected by bootstrap
            agentRoutes:  config.agentRoutes || [],     // [{ intent, spiffeID, capability }]
        };

        this._genAI     = null;  // VertexAI model instance
        this._auth      = null;  // GoogleAuth for REST fallback
        this._useVertex = false;
        this._sessions  = new Map(); // sessionId -> conversation history
    }

    /* ------------------------------------------------------------------ */
    /* Lifecycle                                                            */
    /* ------------------------------------------------------------------ */

    async initialize() {
        if (VertexAI && this.config.project) {
            try {
                const vx  = new VertexAI({ project: this.config.project, location: this.config.location });
                this._genAI     = vx.getGenerativeModel({
                    model: this.config.model,
                    generationConfig: {
                        temperature:     this.config.temperature,
                        maxOutputTokens: this.config.maxOutputTokens,
                    },
                    safetySettings: DEFAULT_SAFETY_SETTINGS,
                    systemInstruction: { role: 'system', parts: [{ text: this.config.systemPrompt }] },
                });
                this._useVertex = true;
                console.info(`[AIOrchestrator] Vertex AI ready: ${this.config.project}/${this.config.model}`);
            } catch (err) {
                console.warn('[AIOrchestrator] Vertex AI init failed, falling back to developer API:', err.message);
            }
        }

        if (!this._useVertex && GoogleAuth && this.config.project) {
            this._auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
        }

        if (!this._useVertex && !this.config.apiKey) {
            console.warn('[AIOrchestrator] No GEMINI_API_KEY or Vertex credentials. AI calls will fail.');
        }

        this.emit('ready');
        return this;
    }

    /* ------------------------------------------------------------------ */
    /* Core: generate a response for a user query                          */
    /* ------------------------------------------------------------------ */

    /**
     * @param {string}  query       - Natural language prompt
     * @param {object}  [opts]
     * @param {string}  [opts.sessionId]  - Persist conversation history
     * @param {object}  [opts.context]    - Extra key→value context injected into prompt
     * @param {Array}   [opts.tools]      - Gemini tool definitions (function declarations)
     * @returns {Promise<{ text: string, functionCalls?: Array, usage?: object }>}
     */
    async generate(query, opts = {}) {
        const { sessionId, context = {}, tools = [] } = opts;

        const history  = sessionId ? this._getHistory(sessionId) : [];
        const parts    = this._buildParts(query, context);

        let result;
        if (this._useVertex && this._genAI) {
            result = await this._vertexGenerate(parts, history, tools);
        } else {
            result = await this._restGenerate(parts, history, tools);
        }

        if (sessionId) this._appendHistory(sessionId, query, result.text);

        // Route to sub-agent if Gemini returned a function call
        if (result.functionCalls?.length && this.config.a2aAdapter) {
            result = await this._dispatchFunctionCalls(result.functionCalls, result, sessionId);
        }

        this.emit('generate:complete', { sessionId, tokens: result.usage });
        return result;
    }

    /**
     * Convenience: route a task to a registered specialized agent via A2A.
     */
    async delegateToAgent(intent, parameters, sessionId) {
        const route = this.config.agentRoutes.find(r => r.intent === intent);
        if (!route) throw new Error(`No agent route for intent: ${intent}`);
        if (!this.config.a2aAdapter) throw new Error('No A2A adapter configured on AIOrchestrator');

        return this.config.a2aAdapter.sendTask(route.spiffeID, {
            capability: route.capability,
            parameters,
            traceId:    sessionId
        });
    }

    /* ------------------------------------------------------------------ */
    /* Vertex AI SDK path                                                  */
    /* ------------------------------------------------------------------ */

    async _vertexGenerate(parts, history, tools) {
        const chat = this._genAI.startChat({
            history: history.map(h => ({
                role:  h.role,
                parts: [{ text: h.text }]
            })),
            tools: tools.length ? [{ functionDeclarations: tools }] : []
        });
        const resp      = await chat.sendMessage(parts);
        const candidate = resp.response?.candidates?.[0];
        const text      = candidate?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
        const funcCalls = candidate?.content?.parts
            ?.filter(p => p.functionCall)
            .map(p => p.functionCall) || [];
        const usage = resp.response?.usageMetadata;
        return { text, functionCalls: funcCalls, usage };
    }

    /* ------------------------------------------------------------------ */
    /* REST fallback (Gemini Developer API or Vertex REST)                 */
    /* ------------------------------------------------------------------ */

    async _restGenerate(parts, history, tools) {
        let endpoint, headers;

        if (this.config.apiKey) {
            // Gemini Developer API
            endpoint = `https://generativelanguage.googleapis.com/v1beta/models/` +
                       `${this.config.model}:generateContent?key=${this.config.apiKey}`;
            headers = { 'Content-Type': 'application/json' };
        } else {
            // Vertex REST
            const token = await this._auth.getAccessToken();
            endpoint = `https://${this.config.location}-aiplatform.googleapis.com/v1/projects/` +
                       `${this.config.project}/locations/${this.config.location}/publishers/google/` +
                       `models/${this.config.model}:generateContent`;
            headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
        }

        const body = {
            contents: [
                ...history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
                { role: 'user', parts }
            ],
            systemInstruction: { role: 'system', parts: [{ text: this.config.systemPrompt }] },
            generationConfig: { temperature: this.config.temperature, maxOutputTokens: this.config.maxOutputTokens },
            safetySettings: DEFAULT_SAFETY_SETTINGS,
        };
        if (tools.length) body.tools = [{ functionDeclarations: tools }];

        const raw       = await this._post(endpoint, body, headers);
        const candidate = raw.candidates?.[0];
        const text      = candidate?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
        const funcCalls = candidate?.content?.parts?.filter(p => p.functionCall).map(p => p.functionCall) || [];
        return { text, functionCalls: funcCalls, usage: raw.usageMetadata };
    }

    /* ------------------------------------------------------------------ */
    /* Function-call dispatch → A2A                                        */
    /* ------------------------------------------------------------------ */

    async _dispatchFunctionCalls(calls, baseResult, sessionId) {
        const results = [];
        for (const call of calls) {
            const route = this.config.agentRoutes.find(r =>
                r.intent === call.name || r.capability === call.name
            );
            if (route) {
                try {
                    const agentResult = await this.config.a2aAdapter.sendTask(route.spiffeID, {
                        capability: route.capability,
                        parameters: call.args,
                        traceId:    sessionId
                    });
                    results.push({ name: call.name, result: agentResult });
                } catch (err) {
                    results.push({ name: call.name, error: err.message });
                }
            } else {
                results.push({ name: call.name, error: 'No route registered for this function' });
            }
        }
        return { ...baseResult, functionCallResults: results };
    }

    /* ------------------------------------------------------------------ */
    /* Session history management                                          */
    /* ------------------------------------------------------------------ */

    _getHistory(sessionId) {
        if (!this._sessions.has(sessionId)) this._sessions.set(sessionId, []);
        return this._sessions.get(sessionId).slice(-20); // last 20 turns
    }

    _appendHistory(sessionId, query, response) {
        if (!this._sessions.has(sessionId)) this._sessions.set(sessionId, []);
        const h = this._sessions.get(sessionId);
        h.push({ role: 'user',  text: query    });
        h.push({ role: 'model', text: response });
        // Cap at 40 entries (20 turns)
        if (h.length > 40) h.splice(0, h.length - 40);
    }

    clearSession(sessionId) {
        this._sessions.delete(sessionId);
    }

    /* ------------------------------------------------------------------ */
    /* HTTP helper                                                         */
    /* ------------------------------------------------------------------ */

    _post(url, body, headers) {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify(body);
            const u    = new URL(url);
            const req  = https.request({
                hostname: u.hostname,
                port:     u.port || 443,
                path:     u.pathname + u.search,
                method:   'POST',
                headers:  { ...headers, 'Content-Length': Buffer.byteLength(data) },
                timeout:  30000
            }, res => {
                let buf = '';
                res.on('data', c => buf += c);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(buf);
                        if (res.statusCode >= 400)
                            reject(new Error(`Gemini API ${res.statusCode}: ${buf.slice(0, 300)}`));
                        else resolve(parsed);
                    } catch (e) { reject(e); }
                });
            });
            req.on('timeout', () => { req.destroy(); reject(new Error('Gemini request timed out')); });
            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }

    /* ------------------------------------------------------------------ */
    /* Internal helpers                                                    */
    /* ------------------------------------------------------------------ */

    _buildParts(query, context) {
        const parts = [{ text: query }];
        if (Object.keys(context).length) {
            parts.unshift({ text: `Context: ${JSON.stringify(context)}\n\n` });
        }
        return parts;
    }
}

/* ------------------------------------------------------------------ */
/* Defaults                                                            */
/* ------------------------------------------------------------------ */

const DEFAULT_SYSTEM_PROMPT = `You are Br3eze AgentOS — a multi-purpose enterprise AI assistant.
You manage network infrastructure (MikroTik), process invoices, and coordinate specialized agents.
Always respond concisely and in plain language. When delegating to specialized agents, confirm the action taken.
Current capabilities: invoice processing, network management, user management, system diagnostics.`;

const DEFAULT_SAFETY_SETTINGS = [
    { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
];

module.exports = { AIOrchestrator };
