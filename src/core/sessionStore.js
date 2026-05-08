'use strict';
/**
 * SessionStore — JSON-backed agent session persistence
 */

const fs   = require('fs');
const path = require('path');
const { STATE_PATH } = require('./config');

const SESSION_DIR = path.join(STATE_PATH, 'sessions');

function ensureDir() {
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
}

/**
 * @typedef {object} StoredSession
 * @property {string}   sessionId
 * @property {string[]} messages     User/assistant turn prompts
 * @property {number}   inputTokens
 * @property {number}   outputTokens
 * @property {string}   createdAt    ISO timestamp
 * @property {string}   updatedAt    ISO timestamp
 */

/**
 * Persist a session to disk.
 * @param {StoredSession} session
 * @returns {string} file path
 */
function saveSession(session) {
    ensureDir();
    const payload = { ...session, updatedAt: new Date().toISOString() };
    const filePath = path.join(SESSION_DIR, `${session.sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    return filePath;
}

/**
 * Load a session from disk.
 * @param {string} sessionId
 * @returns {StoredSession}
 */
function loadSession(sessionId) {
    ensureDir();
    const filePath = path.join(SESSION_DIR, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) throw new Error(`Session not found: ${sessionId}`);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * List all persisted session IDs.
 * @returns {string[]}
 */
function listSessions() {
    ensureDir();
    return fs.readdirSync(SESSION_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
}

/**
 * Delete a persisted session.
 * @param {string} sessionId
 */
function deleteSession(sessionId) {
    const filePath = path.join(SESSION_DIR, `${sessionId}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = { saveSession, loadSession, listSessions, deleteSession };
