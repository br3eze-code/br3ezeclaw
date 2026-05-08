'use strict';
/**
 * CostTracker — tracks LLM token usage and estimated costs.
 * Ported from 36.js §4
 */

class CostTracker {
    constructor() {
        this.totalInputTokens = 0;
        this.totalOutputTokens = 0;
        this._events = [];
    }

    record(label, inputTokens = 0, outputTokens = 0) {
        this.totalInputTokens += (inputTokens || 0);
        this.totalOutputTokens += (outputTokens || 0);
        this._events.push({ 
            label, 
            inputTokens, 
            outputTokens, 
            ts: Date.now() 
        });
        
        // Keep last 1000 events
        if (this._events.length > 1000) {
            this._events.shift();
        }
    }

    snapshot() {
        // Rates per 1k tokens (example rates)
        const INPUT_RATE = 0.00000025; // $0.00025 per 1k
        const OUTPUT_RATE = 0.00000075; // $0.00075 per 1k
        
        return {
            totalInputTokens: this.totalInputTokens,
            totalOutputTokens: this.totalOutputTokens,
            estimatedUSD: ((this.totalInputTokens * INPUT_RATE) + (this.totalOutputTokens * OUTPUT_RATE)).toFixed(6),
            eventCount: this._events.length
        };
    }

    getRecentEvents(limit = 10) {
        return this._events.slice(-limit).reverse();
    }

    reset() {
        this.totalInputTokens = 0;
        this.totalOutputTokens = 0;
        this._events = [];
    }

    // ── Legacy Aliases ────────────────────────────────────────────────────────
    
    track(tokens, model) {
        // Map tokens to input/output approximation if not split
        this.record(model, tokens, 0);
    }

    getSummary() {
        const snap = this.snapshot();
        return { 
            total: snap.estimatedUSD, 
            requests: snap.eventCount,
            tokens: snap.totalInputTokens + snap.totalOutputTokens 
        };
    }
}

// Singleton instance
const costTracker = new CostTracker();

module.exports = { CostTracker, costTracker };
