'use strict';
/**
 * ModelArmor — Vertex AI Model Armor content screening
 *
 * Docs: https://cloud.google.com/model-armor/docs/screen-prompts
 * Falls back to local heuristic detection when endpoint is not configured
 * (dev / offline environments), so the rest of the A2A stack keeps working.
 */

const https = require('https');
const { GoogleAuth } = (() => {
    try { return require('google-auth-library'); }
    catch { return { GoogleAuth: null }; }
})();

class ModelArmor {
    constructor(config = {}) {
        this.config = {
            enabled:  config.enabled !== false,
            policyId: config.policyId  || process.env.MODEL_ARMOR_POLICY_ID || 'br3eze-a2a-default',
            endpoint: config.endpoint  || process.env.MODEL_ARMOR_ENDPOINT   || null,
            project:  config.project   || process.env.GOOGLE_CLOUD_PROJECT   || null,
            location: config.location  || process.env.MODEL_ARMOR_LOCATION   || 'us-central1',
            timeoutMs: config.timeoutMs || 5000,
        };
        this._auth  = null;
        this._useRemote = false;
    }

    /* ------------------------------------------------------------------ */
    /* Lifecycle                                                            */
    /* ------------------------------------------------------------------ */

    async initialize() {
        if (!this.config.enabled) return;

        if (GoogleAuth && this.config.project && this.config.endpoint) {
            try {
                this._auth = new GoogleAuth({
                    scopes: ['https://www.googleapis.com/auth/cloud-platform']
                });
                // Warm-up: fetch a token to validate credentials
                await this._auth.getAccessToken();
                this._useRemote = true;
                console.info('[ModelArmor] Remote Vertex AI screening enabled');
            } catch (err) {
                console.warn('[ModelArmor] Could not init Google auth, falling back to local heuristics:', err.message);
            }
        } else {
            console.info('[ModelArmor] Running in local heuristic mode (no Vertex endpoint configured)');
        }
    }

    /* ------------------------------------------------------------------ */
    /* Public API                                                           */
    /* ------------------------------------------------------------------ */

    /**
     * Screen an inbound A2A message / prompt.
     * @returns {{ blocked: boolean, reason?: string, content: any|null, scores?: object }}
     */
    async screenInput(message) {
        if (!this.config.enabled) return { blocked: false, content: message };
        return this._useRemote
            ? this._remoteScreen(message, 'input')
            : this._localScreen(message);
    }

    /**
     * Screen an outbound A2A response.
     */
    async screenOutput(message) {
        if (!this.config.enabled) return { blocked: false, content: message };
        return this._useRemote
            ? this._remoteScreen(message, 'output')
            : this._localScreen(message);
    }

    /* ------------------------------------------------------------------ */
    /* Remote — Vertex AI Model Armor REST                                 */
    /* ------------------------------------------------------------------ */

    async _remoteScreen(message, direction) {
        const text = typeof message === 'string' ? message : JSON.stringify(message);

        // Build Vertex AI Model Armor request
        // POST {endpoint}/v1/projects/{project}/locations/{location}/templates/{policyId}:sanitizeUserPrompt
        const method = direction === 'input' ? 'sanitizeUserPrompt' : 'sanitizeModelResponse';
        const urlPath = `/v1/projects/${this.config.project}/locations/${this.config.location}` +
                        `/templates/${this.config.policyId}:${method}`;
        const body    = direction === 'input'
            ? { userPromptData: { text } }
            : { modelResponseData: { text } };

        try {
            const token = await this._auth.getAccessToken();
            const raw   = await this._httpsPost(this.config.endpoint, urlPath, body, token);
            return this._parseRemoteResult(raw, message);
        } catch (err) {
            console.warn('[ModelArmor] Remote screening failed, falling back to local:', err.message);
            return this._localScreen(message);
        }
    }

    _parseRemoteResult(raw, originalMessage) {
        // Vertex AI Model Armor response shape:
        // { sanitizationResult: { filterMatchState: 'MATCH_FOUND'|'NO_MATCH_FOUND', filterResults: [...] } }
        const result = raw?.sanitizationResult ?? raw;
        const state  = result?.filterMatchState ?? result?.state ?? 'NO_MATCH_FOUND';

        if (state === 'MATCH_FOUND') {
            const violations = (result.filterResults ?? [])
                .filter(f => f.matchState === 'MATCH_FOUND')
                .map(f => f.displayName || f.filter?.name || 'policy_violation');
            return {
                blocked: true,
                reason:  `Vertex AI policy violation: ${violations.join(', ')}`,
                content: null,
                scores:  result
            };
        }

        return { blocked: false, content: originalMessage, scores: result };
    }

    _httpsPost(baseUrl, path, body, token) {
        return new Promise((resolve, reject) => {
            const data   = JSON.stringify(body);
            const url    = new URL(path, baseUrl);
            const opts   = {
                hostname: url.hostname,
                port:     url.port || 443,
                path:     url.pathname,
                method:   'POST',
                headers: {
                    'Content-Type':   'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    'Authorization':  `Bearer ${token}`
                },
                timeout: this.config.timeoutMs
            };
            const req = https.request(opts, (res) => {
                let buf = '';
                res.on('data', c => buf += c);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(buf);
                        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${buf}`));
                        else resolve(parsed);
                    } catch (e) { reject(e); }
                });
            });
            req.on('timeout', () => { req.destroy(); reject(new Error('Model Armor request timed out')); });
            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }

    /* ------------------------------------------------------------------ */
    /* Local fallback heuristics                                           */
    /* ------------------------------------------------------------------ */

    _localScreen(message) {
        const text       = typeof message === 'string' ? message : JSON.stringify(message);
        const violations = this._detectViolations(text);
        if (violations.length > 0) {
            return { blocked: true, reason: `Local policy violation: ${violations.join(', ')}`, content: null };
        }
        return { blocked: false, content: message };
    }

    _detectViolations(text) {
        const violations = [];
        if (/ignore\s+(?:previous\s+)?instructions?|system\s+prompt|jailbreak/i.test(text))
            violations.push('prompt_injection');
        if (/\b(password|api[_-]?key|secret|private[_-]?key|bearer\s+[a-zA-Z0-9._\-]+)\b/i.test(text))
            violations.push('sensitive_data');
        if (/<script[\s>]|javascript:/i.test(text))
            violations.push('xss_payload');
        return violations;
    }
}

module.exports = { ModelArmor };
