'use strict';
/**
 * AgentMemory — migrated from ss35.js §4
 * Persistent key-value store for cross-session AI context injection.
 * Backed by a local JSON file at STATE_PATH/memory.json.
 */
const fs   = require('fs');
const path = require('path');
const { logger } = require('./logger');
const { STATE_PATH } = require('./config');

class AgentMemory {
    constructor() {
        this._path  = path.join(STATE_PATH, 'memory.json');
        this._store = {};
        this._load();
    }

    // ── Persistence ───────────────────────────────────────────────────────────

    _load() {
        try {
            if (fs.existsSync(this._path)) {
                this._store = JSON.parse(fs.readFileSync(this._path, 'utf8'));
                logger.info(`AgentMemory: loaded ${Object.keys(this._store).length} entries`);
            }
        } catch (err) {
            logger.warn(`AgentMemory: load failed (${err.message}) — starting fresh`);
            this._store = {};
        }
    }

    _save() {
        try {
            if (!fs.existsSync(STATE_PATH)) fs.mkdirSync(STATE_PATH, { recursive: true });
            fs.writeFileSync(this._path, JSON.stringify(this._store, null, 2));
        } catch (err) {
            logger.error(`AgentMemory: save failed: ${err.message}`);
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Store a value under a key with a timestamp.
     * @param {string} key
     * @param {*} value
     */
    remember(key, value) {
        this._store[key] = { value, updatedAt: new Date().toISOString() };
        this._save();
    }

    /**
     * Retrieve the value stored under key, or null if absent.
     * @param {string} key
     * @returns {*}
     */
    recall(key) {
        return this._store[key]?.value ?? null;
    }

    /**
     * Return all stored key-value pairs (without timestamps).
     * @returns {Object}
     */
    recallAll() {
        return Object.fromEntries(
            Object.entries(this._store).map(([k, v]) => [k, v.value])
        );
    }

    /**
     * Delete a key from memory.
     * @param {string} key
     */
    forget(key) {
        delete this._store[key];
        this._save();
    }

    /** Clear all memory entries. */
    clear() {
        this._store = {};
        this._save();
    }

    /**
     * Build a compact context string for injection into AI system prompts.
     * Returns an empty string if memory is empty.
     * @returns {string}
     */
    getContext() {
        const entries = Object.entries(this._store);
        if (!entries.length) return '';
        const lines = entries.map(([k, v]) => `- ${k}: ${JSON.stringify(v.value)}`).join('\n');
        return `[Agent Memory]\n${lines}`;
    }

    /**
     * Number of stored entries.
     * @returns {number}
     */
    get size() {
        return Object.keys(this._store).length;
    }
}

// Singleton
module.exports = new AgentMemory();
