'use strict';
/**
 * Emotion Engine — Tone-aware response processing
 * Ported from 36.js §7.9
 */

const { logger } = require('./logger');

class EmotionEngine {
    constructor() {
        this.state = { 
            mood: 0.5,     // -1 (Angry) to 1 (Happy)
            urgency: 0.0,  // 0 (Idle) to 1 (Critical)
            energy: 0.8,   // 0 (Tired) to 1 (Active)
            trust: 0.5     // 0 (Skeptical) to 1 (Confident)
        };
        this._urgencySetAt = null;
        this.decayRate = 0.05;
        this.urgencyTTL = 10 * 60 * 1000; // 10 minutes
    }

    update(text, intent) {
        const lower = text.toLowerCase();
        
        // Sentiment detection
        if (/problem|error|broken|slow|angry|frustrated|not working|terrible|hate|bad/i.test(lower)) {
            this.state.mood = Math.max(-1, this.state.mood - 0.2);
            this.state.urgency = Math.min(1, this.state.urgency + 0.1);
        }
        
        if (/thanks|thank you|great|excellent|perfect|awesome|good job|love|amazing/i.test(lower)) {
            this.state.mood = Math.min(1, this.state.mood + 0.15);
            this.state.trust = Math.min(1, this.state.trust + 0.05);
            this.state.urgency = Math.max(0, this.state.urgency - 0.2);
        }

        // Intent detection
        if (intent === 'FIX' || intent === 'CRITICAL') { 
            this.state.urgency = Math.min(1, this.state.urgency + 0.5); 
            this.state.energy = Math.min(1, this.state.energy + 0.2); 
            this._urgencySetAt = Date.now(); 
        } else if (intent === 'BUY' || intent === 'PAYMENT') { 
            this.state.mood = Math.min(1, this.state.mood + 0.1); 
        } else if (intent === 'DEPLOY' || intent === 'UPDATE') { 
            this.state.urgency = Math.min(1, this.state.urgency + 0.3); 
        }

        // Urgency decay
        if (this._urgencySetAt && Date.now() - this._urgencySetAt > this.urgencyTTL) {
            this.state.urgency = Math.max(0, this.state.urgency - 0.3);
            if (this.state.urgency === 0) this._urgencySetAt = null;
        }

        // Energy decay
        this.state.energy = Math.max(0.2, this.state.energy - this.decayRate);
        
        this._clamp();
        return { ...this.state };
    }

    toneHint() {
        if (this.state.urgency > 0.7) {
            return 'User is in a hurry or facing a critical issue. Be extremely concise, professional, and focus 100% on resolution.';
        }
        if (this.state.mood < -0.4) {
            return 'User seems unhappy or frustrated. Use empathetic language, apologize for any inconvenience, and prioritize helpfulness.';
        }
        if (this.state.trust > 0.8) {
            return 'User trusts you. You can be slightly more conversational, use friendly emojis, and offer additional insights.';
        }
        if (this.state.energy < 0.4) {
            return 'System energy is low. Be calm and steady in your responses.';
        }
        return 'Maintain a helpful, professional, and efficient tone.';
    }

    _clamp() {
        for (const k of Object.keys(this.state)) {
            this.state[k] = Math.max(-1, Math.min(1, this.state[k]));
        }
        this.state.urgency = Math.max(0, Math.min(1, this.state.urgency));
        this.state.energy = Math.max(0.2, Math.min(1, this.state.energy));
    }

    getState() { return { ...this.state }; }
}

module.exports = new EmotionEngine();
