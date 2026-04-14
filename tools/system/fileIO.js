'use strict';
const fs   = require('fs');
const path = require('path');
const { logger } = require('../../src/core/logger');

// ── Path helpers ──────────────────────────────────────────────────────────────

function resolvePath(filePath) {
    return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}
 
function ensureDirectory(dirPath) {
    const resolved = resolvePath(dirPath);
    if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
}

// ── JSON file operations ──────────────────────────────────────────────────────

/**
 * Standard JSON Read with fallback support
 */
function readFile(filePath, fallback = null) {
    try {
        const resolved = resolvePath(filePath);
        if (!fs.existsSync(resolved)) return fallback;
        const data = fs.readFileSync(resolved, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        logger.error('File read failed', { filePath, error: err.message });
        return fallback;
    }
}

/**
 * Standard JSON Write with directory auto-creation
 */
function writeFile(filePath, data) {
    try {
        const resolved = resolvePath(filePath);
        ensureDirectory(path.dirname(resolved));
        fs.writeFileSync(resolved, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        logger.error('File write failed', { filePath, error: err.message });
        return false;
    }
}

/**
 * Append record to JSON array in file
 */
function appendJson(filePath, record) {
    try {
        const existing = readFile(filePath, []) || [];
        existing.push(record);
        return writeFile(filePath, existing);
    } catch (err) {
        logger.error('File append failed', { filePath, error: err.message });
        return false;
    }
}

// ── Raw file operations ───────────────────────────────────────────────────────
 
function readRaw(filePath, encoding = 'utf8') {
    try {
        return fs.readFileSync(resolvePath(filePath), encoding);
    } catch (err) {
        logger.error('Raw read failed', { filePath, error: err.message });
        return null;
    }
}
 
function writeRaw(filePath, data, encoding = 'utf8') {
    try {
        const resolved = resolvePath(filePath);
        ensureDirectory(path.dirname(resolved));
        fs.writeFileSync(resolved, data, encoding);
        return true;
    } catch (err) {
        logger.error('Raw write failed', { filePath, error: err.message });
        return false;
    }
}
 
function appendRaw(filePath, data, encoding = 'utf8') {
    try {
        const resolved = resolvePath(filePath);
        ensureDirectory(path.dirname(resolved));
        fs.appendFileSync(resolved, data, encoding);
        return true;
    } catch (err) {
        logger.error('Raw append failed', { filePath, error: err.message });
        return false;
    }
}
 
function deleteFile(filePath) {
    try {
        const resolved = resolvePath(filePath);
        if (fs.existsSync(resolved)) {
            fs.unlinkSync(resolved);
            return true;
        }
        return false;
    } catch (err) {
        logger.error('File deletion failed', { filePath, error: err.message });
        return false;
    }
}
 
function fileExists(filePath) {
    return fs.existsSync(resolvePath(filePath));
}
 
function listDirectory(dirPath) {
    try {
        return fs.readdirSync(resolvePath(dirPath));
    } catch (err) {
        logger.error('Directory list failed', { dirPath, error: err.message });
        return [];
    }
}
 
function getFileStats(filePath) {
    try {
        return fs.statSync(resolvePath(filePath));
    } catch (err) {
        logger.error('File stats failed', { filePath, error: err.message });
        return null;
    }
}
 
// ── In-memory cache ───────────────────────────────────────────────────────────
 
const memoryCache = {};
 
function setCache(key, value) {
    memoryCache[key] = { value, time: Date.now() };
}
 
function getCache(key, ttl = 60000) {
    const item = memoryCache[key];
    if (!item) return null;
    if (Date.now() - item.time > ttl) { 
        delete memoryCache[key]; 
        return null; 
    }
    return item.value;
}
 
function clearCache(key) {
    if (key) {
        delete memoryCache[key];
    } else {
        Object.keys(memoryCache).forEach(k => delete memoryCache[k]);
    }
}

module.exports = {
    resolvePath, 
    ensureDirectory,
    writeFile, 
    readFile, 
    appendJson,
    readRaw, 
    writeRaw, 
    appendRaw,
    deleteFile, 
    fileExists, 
    listDirectory, 
    getFileStats,
    setCache, 
    getCache, 
    clearCache
};
