'use strict';
/**
 * ChatRegistry — Manages persistent mapping of chat IDs across channels
 * Used for broadcasting notifications and alerts to known users.
 */
const { getDatabase } = require('./database');
const { logger } = require('./logger');

class ChatRegistry {
    constructor() {
        this.chats = new Map(); // channel -> Set(chatId)
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        try {
            const db = await getDatabase();
            // Load from database if exists
            const saved = await db.getAuditLog(100); // Placeholder, ideally a dedicated collection
            // For now, we'll just use the memory map and rely on incoming messages to populate it
            // In a real scenario, we'd have a 'chats' collection in Firestore/LocalDB
            this.initialized = true;
            logger.info('ChatRegistry: initialized');
        } catch (err) {
            logger.error('ChatRegistry init failed:', err);
        }
    }

    register(channel, chatId) {
        if (!this.chats.has(channel)) {
            this.chats.set(channel, new Set());
        }
        const chatSet = this.chats.get(channel);
        if (!chatSet.has(chatId)) {
            chatSet.add(chatId);
            logger.debug(`ChatRegistry: registered ${chatId} on ${channel}`);
            // TODO: Persist to DB
        }
    }

    getChats(channel) {
        return Array.from(this.chats.get(channel) || []);
    }

    getAll() {
        const result = [];
        for (const [channel, set] of this.chats.entries()) {
            for (const chatId of set) {
                result.push({ channel, chatId });
            }
        }
        return result;
    }
}

let instance = null;
function getChatRegistry() {
    if (!instance) instance = new ChatRegistry();
    return instance;
}

module.exports = { getChatRegistry };
