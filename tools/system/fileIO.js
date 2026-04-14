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

function readFile(filePath, options = {}) {
    const resolved = resolvePath(filePath);
    const encoding = options.encoding || "utf8";
    return fs.readFileSync(resolved, encoding);
}

function writeFile(filePath, data, options = {}) {
    const resolved = resolvePath(filePath);
    const encoding = options.encoding || "utf8";
    fs.writeFileSync(resolved, data, encoding);
}

function readJson(filePath, options = {}) {
    const resolved = resolvePath(filePath);
    const encoding = options.encoding || "utf8";
    const data = fs.readFileSync(resolved, encoding);
    return JSON.parse(data);
}

function writeJson(filePath, data, options = {}) {
    const resolved = resolvePath(filePath);
    const encoding = options.encoding || "utf8";
    const jsonString = JSON.stringify(data, null, 2);
    fs.writeFileSync(resolved, jsonString, encoding);
}

function appendFile(filePath, data, options = {}) {
    const resolved = resolvePath(filePath);
    const encoding = options.encoding || "utf8";
    fs.appendFileSync(resolved, data, encoding);
}

function deleteFile(filePath) {
    const resolved = resolvePath(filePath);
    fs.unlinkSync(resolved);
}

function fileExists(filePath) {
    const resolved = resolvePath(filePath);
    return fs.existsSync(resolved);
}

function listDirectory(dirPath) {
    const resolved = resolvePath(dirPath);
    return fs.readdirSync(resolved);
}

function getFileSize(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).size;
}

function getFileStats(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved);
}

function getFileModificationTime(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mtime;
}

function getFileAccessTime(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).atime;
}

function getFileCreationTime(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).birthtime;
}

function getFileOwner(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).uid;
}

function getFileGroup(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).gid;
}

function getFilePermissions(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFileOwnerName(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).uid;
}

function getFileGroupName(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).gid;
}

function getFilePermissionsName(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsOctal(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}

function getFilePermissionsSymbolic(filePath) {
    const resolved = resolvePath(filePath);
    return fs.statSync(resolved).mode;
}
// ── Raw file operations ───────────────────────────────────────────────────────
 
function readRaw(filePath, encoding = 'utf8') {
    return fs.readFileSync(resolvePath(filePath), encoding);
}
 
function writeRaw(filePath, data, encoding = 'utf8') {
    const fullPath = resolvePath(filePath);
    ensureDirectory(path.dirname(fullPath));
    fs.writeFileSync(fullPath, data, encoding);
}
 
function appendRaw(filePath, data, encoding = 'utf8') {
    fs.appendFileSync(resolvePath(filePath), data, encoding);
}
 
function deleteFile(filePath) {
    fs.unlinkSync(resolvePath(filePath));
}
 
function fileExists(filePath) {
    return fs.existsSync(resolvePath(filePath));
}
 
function listDirectory(dirPath) {
    return fs.readdirSync(resolvePath(dirPath));
}
 
function getFileStats(filePath) {
    return fs.statSync(resolvePath(filePath));
}
 
// ── In-memory cache ───────────────────────────────────────────────────────────
 
const memoryCache = {};
 
function setCache(key, value) {
    memoryCache[key] = { value, time: Date.now() };
}
 
function getCache(key, ttl = 60000) {
    const item = memoryCache[key];
    if (!item) return null;
    if (Date.now() - item.time > ttl) { delete memoryCache[key]; return null; }
    return item.value;
}
 
function clearCache(key) {
    if (key) delete memoryCache[key];
    else Object.keys(memoryCache).forEach(k => delete memoryCache[k]);
}

export function writeFile(filePath, data) {
    try {
        const fullPath = resolvePath(filePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), "utf-8");
        return true;
    } catch (err) {
        logger.error("File write failed", { filePath, error: err.message });
        return false;
    }
}
export function readFile(filePath, fallback = null) {
    try {
        const fullPath = resolvePath(filePath);
        if (!fs.existsSync(fullPath)) return fallback;
        return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
    } catch (err) {
        logger.error("File read failed", { filePath, error: err.message });
        return fallback;
    }
}


export function appendJson(filePath, record) {
    try {
        const fullPath = resolvePath(filePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        let existing = [];
        if (fs.existsSync(fullPath)) existing = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
        existing.push(record);
        fs.writeFileSync(fullPath, JSON.stringify(existing, null, 2), "utf-8");
        return true;
    } catch (err) {
        logger.error("File append failed", { filePath, error: err.message });
        return false;
    }
}


export function setCache(key, value) {
    memoryCache[key] = { value, time: Date.now() };
}

export function getCache(key, ttl = 60000) {
    const item = memoryCache[key];
    if (!item) return null;
    if (Date.now() - item.time > ttl) { delete memoryCache[key]; return null; }
    return item.value;
}
module.exports = {
    resolvePath, ensureDirectory,
    writeFile, readFile, appendJson,
    readRaw, writeRaw, appendRaw,
    deleteFile, fileExists, listDirectory, getFileStats,
    setCache, getCache, clearCache
};
