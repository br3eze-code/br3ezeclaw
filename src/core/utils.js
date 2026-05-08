'use strict';

const crypto = require('crypto');

/**
 * Common utilities for AgentOS
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const uid = () => crypto.randomUUID();

function fmtBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024, units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
    return `${(bytes / k ** i).toFixed(2)} ${units[i]}`;
}

function fmtUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

function truncate(s, max = 3500) {
    if (!s) return '';
    return s.length > max ? s.slice(0, max) + '\n…(truncated)' : s;
}

module.exports = {
    sleep,
    uid,
    fmtBytes,
    fmtUptime,
    truncate
};
