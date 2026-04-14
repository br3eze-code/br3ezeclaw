#!/usr/bin/env node
'use strict';

/**
 * AgentOS Pre-uninstall
 * Cleans up PATH entries and stops running gateway
 * SAFE: no require() of app code — avoids crash on fresh/broken installs
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Stop gateway if running ───────────────────────────────────────────────────
// Resolve state path directly — do NOT require app modules (they may not be installed)
const STATE_PATH = process.env.AGENTOS_STATE_PATH
    || path.join(os.homedir(), '.agentos', 'state');
const pidFile = path.join(STATE_PATH, 'gateway.pid');

if (fs.existsSync(pidFile)) {
    try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        if (pid > 0) {
            process.kill(pid, 'SIGTERM');
            console.log('[AgentOS] Gateway stopped (PID %d)', pid);
        }
    } catch {
        // Gateway may already be stopped — non-fatal
    }
    try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
}

// ── Remove PATH entries from shell configs ────────────────────────────────────
const shellConfigs = [
    path.join(os.homedir(), '.bashrc'),
    path.join(os.homedir(), '.bash_profile'),
    path.join(os.homedir(), '.zshrc'),
    path.join(os.homedir(), '.profile')
];

const PATH_MARKER = /\n# AgentOS PATH\nexport PATH="[^"]*:\$PATH"\n/g;

shellConfigs.forEach(configFile => {
    if (!fs.existsSync(configFile)) return;
    try {
        const original = fs.readFileSync(configFile, 'utf8');
        const cleaned  = original.replace(PATH_MARKER, '');
        if (cleaned !== original) {
            fs.writeFileSync(configFile, cleaned);
            console.log('[AgentOS] Removed PATH entry from', configFile);
        }
    } catch {
        // Non-fatal — user may not have write access
    }
});

console.log('[AgentOS] Uninstalled. Goodbye!');
