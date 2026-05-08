'use strict';
/**
 * OS Adapters — Linux SSH and Windows PowerShell.
 * Ported from 36.js §7.5
 */

const { logger } = require('./logger');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class OSAdapter {
    async connect() { throw new Error('Not implemented'); }
    async exec(_cmd) { throw new Error('Not implemented'); }
    async getSystemStats() { throw new Error('Not implemented'); }
    disconnect() { }
}

class LinuxSSHAdapter extends OSAdapter {
    constructor(opts = {}) {
        super();
        this.isConnected = false;
        this.ssh = null;
        this.host = opts.host || opts.ip;
        this.user = opts.user;
        this.pass = opts.pass;
    }

    async connect() {
        try {
            const { NodeSSH } = require('node-ssh');
            this.ssh = new NodeSSH();
            await this.ssh.connect({
                host: this.host,
                username: this.user,
                password: this.pass,
                tryKeyboard: true
            });
            this.isConnected = true;
            logger.info(`SSH connected to ${this.host}`);
            return true;
        } catch (err) {
            this.isConnected = false;
            logger.error(`SSH connect failed: ${err.message}`);
            throw err;
        }
    }

    async exec(command) {
        if (!this.isConnected || !this.ssh) throw new Error('SSH not connected');
        const result = await this.ssh.execCommand(command);
        return { stdout: result.stdout, stderr: result.stderr, code: result.code };
    }

    async getSystemStats() {
        const { stdout } = await this.exec('cat /proc/loadavg && free -b && cat /proc/uptime');
        const lines = stdout.split('\n');
        const load = lines[0].split(' ');
        const mem = lines[1].split(/\s+/);
        const uptimeSeconds = parseFloat(lines[2].split(' ')[0]);

        return {
            'cpu-load': Math.round(parseFloat(load[0]) * 100 / os.cpus().length),
            'free-memory': parseInt(mem[3]),
            'total-memory': parseInt(mem[1]),
            uptime: this._fmtUptime(uptimeSeconds),
            version: 'Linux',
        };
    }

    _fmtUptime(seconds) {
        const d = Math.floor(seconds / (24 * 3600));
        const h = Math.floor((seconds % (24 * 3600)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return `${d}d ${h}h ${m}m`;
    }

    disconnect() {
        if (this.ssh) {
            this.ssh.dispose();
            this.ssh = null;
        }
        this.isConnected = false;
    }
}

class WindowsPowerShellAdapter extends OSAdapter {
    constructor(opts = {}) {
        super();
        this.isConnected = false;
        this.host = opts.host || opts.ip;
        this.user = opts.user;
        this.pass = opts.pass;
        this.isLocal = !this.host;
    }

    async connect() {
        if (this.isLocal) {
            this.isConnected = true;
            logger.info('Windows PowerShell adapter ready (local)');
            return true;
        }
        throw new Error('Remote Windows WinRM not yet implemented in modular core');
    }

    async exec(command) {
        if (!this.isConnected) throw new Error('Not connected');
        if (this.isLocal) {
            return new Promise((resolve, reject) => {
                const ps = spawn('powershell.exe', ['-Command', command]);
                let stdout = '', stderr = '';
                ps.stdout.on('data', d => stdout += d);
                ps.stderr.on('data', d => stderr += d);
                ps.on('close', code => resolve({ stdout, stderr, code }));
                ps.on('error', reject);
            });
        }
    }

    async getSystemStats() {
        const command = `Get-CimInstance Win32_Processor | Select-Object LoadPercentage | ConvertTo-Json; Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory,TotalVisibleMemorySize,LastBootUpTime | ConvertTo-Json`;
        const { stdout } = await this.exec(command);
        try {
            // PowerShell might output two separate JSON objects
            const parts = stdout.trim().split(/\r?\n\r?\n/).filter(Boolean);
            const cpu = JSON.parse(parts[0]);
            const osData = JSON.parse(parts[1]);

            return {
                'cpu-load': cpu.LoadPercentage || 0,
                'free-memory': (osData.FreePhysicalMemory || 0) * 1024,
                'total-memory': (osData.TotalVisibleMemorySize || 0) * 1024,
                uptime: this._fmtUptime((Date.now() - new Date(osData.LastBootUpTime).getTime()) / 1000),
                version: 'Windows',
            };
        } catch (e) {
            return { 'cpu-load': 0, 'free-memory': 0, uptime: 'unknown', version: 'Windows' };
        }
    }

    _fmtUptime(seconds) {
        const d = Math.floor(seconds / (24 * 3600));
        const h = Math.floor((seconds % (24 * 3600)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return `${d}d ${h}h ${m}m`;
    }

    disconnect() {
        this.isConnected = false;
    }
}

module.exports = { LinuxSSHAdapter, WindowsPowerShellAdapter };
