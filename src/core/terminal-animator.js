'use strict';

/**
 * TerminalAnimator — migrated from ss35.js §3
 * Provides high-fidelity ANSI animations and CLI visual styling.
 */

const { A } = require('./constants');
const { logger } = require('./logger');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TerminalAnimator = {
    A,

    _hexToAnsi(r, g, b) {
        return `\x1b[38;2;${r};${g};${b}m`;
    },

    _stripAnsi(text) {
        return String(text).replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    },

    _len(text) {
        return this._stripAnsi(text).length;
    },

    gradient(text, startRGB, endRGB) {
        let out = '';
        const chars = [...text];
        for (let i = 0; i < chars.length; i++) {
            const ratio = i / Math.max(chars.length - 1, 1);
            const r = Math.round(startRGB[0] + (endRGB[0] - startRGB[0]) * ratio);
            const g = Math.round(startRGB[1] + (endRGB[1] - startRGB[1]) * ratio);
            const b = Math.round(startRGB[2] + (endRGB[2] - startRGB[2]) * ratio);
            out += `${this._hexToAnsi(r, g, b)}${chars[i]}`;
        }
        return out + A.RESET;
    },

    async showSpinner(message, durationMs = 1000) {
        const spinner = this.createSpinner(message);
        await sleep(durationMs);
        spinner.stop(true);
    },

    createSpinner(message) {
        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let i = 0;
        let msg = message;
        process.stdout.write('\x1b[?25l'); // Hide cursor

        const interval = setInterval(() => {
            process.stdout.write(`\r  ${A.CYBER_PURPLE}${frames[i % frames.length]}${A.RESET} ${msg}`);
            i++;
        }, 80);

        return {
            update: (newMsg) => { msg = newMsg; },
            stop: (success = true) => {
                clearInterval(interval);
                process.stdout.write('\r\x1b[K'); // Clear line
                if (success) {
                    logger.success(msg);
                } else {
                    logger.error(msg);
                }
                process.stdout.write('\x1b[?25h'); // Show cursor
            }
        };
    },

    async typewriter(text, speed = 15) {
        process.stdout.write('  ');
        for (const ch of text) { 
            process.stdout.write(`${A.DIM}${ch}${A.RESET}`); 
            if (ch !== ' ') await sleep(speed); 
        }
        console.log();
    },

    async glitch(text, durationMs = 600) {
        const chars = '!@#$%^&*()_+-=[]{}|;:,.<>?/0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const end = Date.now() + durationMs;
        while (Date.now() < end) {
            const noise = text.split('').map(c => c === ' ' ? ' ' : chars[Math.floor(Math.random() * chars.length)]).join('');
            process.stdout.write(`\r  ${A.NEON_CYAN}${noise}${A.RESET}`);
            await sleep(50);
        }
        process.stdout.write('\r\x1b[K'); // Clear line
        logger.info(text);
    },

    async decode(text, speed = 40) {
        const chars = '0123456789ABCDEF';
        let current = '';
        process.stdout.write('  ');
        for (let i = 0; i < text.length; i++) {
            for (let j = 0; j < 5; j++) {
                const rand = chars[Math.floor(Math.random() * chars.length)];
                process.stdout.write(`\r  ${A.BOLD}${current}${A.NEON_CYAN}${rand}${A.RESET}`);
                await sleep(speed / 2);
            }
            current += text[i];
            process.stdout.write(`\r  ${A.BOLD}${current}${A.RESET}`);
        }
        console.log();
    },

    box(title, content, color = A.PRIMARY) {
        const lines = Array.isArray(content) ? content : String(content).split('\n');
        const titleLen = this._len(title);
        const width = Math.max(titleLen + 4, ...lines.map(l => this._len(l))) + 4;
        
        const top = `${color}┌─ ${A.BOLD}${title}${A.RESET}${color} ${'─'.repeat(Math.max(0, width - titleLen - 3))}┐${A.RESET}`;
        const bottom = `${color}└${'─'.repeat(width)}┘${A.RESET}`;
        
        console.log(top);
        lines.forEach(line => {
            const l = this._len(line);
            console.log(`${color}│${A.RESET}  ${line}${' '.repeat(Math.max(0, width - l - 2))}${color}│${A.RESET}`);
        });
        console.log(bottom);
    },

    table(title, headers, rows, color = A.INFO) {
        const colWidths = headers.map((h, i) => {
            return Math.max(this._len(h), ...rows.map(r => this._len(r[i]))) + 2;
        });

        const totalWidth = colWidths.reduce((a, b) => a + b, 0) + colWidths.length + 1;
        
        // Header
        this.printHeader(title);
        
        let headerRow = color + '│';
        headers.forEach((h, i) => {
            headerRow += ` ${A.BOLD}${h}${A.RESET}${' '.repeat(colWidths[i] - this._len(h) - 1)}${color}│`;
        });
        
        const separator = color + '├' + colWidths.map(w => '─'.repeat(w)).join('┼') + '┤' + A.RESET;
        const topEdge = color + '┌' + colWidths.map(w => '─'.repeat(w)).join('┬') + '┐' + A.RESET;
        const bottomEdge = color + '└' + colWidths.map(w => '─'.repeat(w)).join('┴') + '┘' + A.RESET;

        console.log(topEdge);
        console.log(headerRow + A.RESET);
        console.log(separator);

        rows.forEach(row => {
            let rowStr = color + '│';
            row.forEach((cell, i) => {
                rowStr += ` ${cell}${' '.repeat(colWidths[i] - this._len(cell) - 1)}${color}│`;
            });
            console.log(rowStr + A.RESET);
        });

        console.log(bottomEdge);
    },

    async animateProgressBar(label, durationMs = 2000, width = 30) {
        process.stdout.write('\x1b[?25l'); // Hide cursor
        const start = Date.now();
        while (Date.now() - start < durationMs) {
            const elapsed = Date.now() - start;
            const ratio = Math.min(elapsed / durationMs, 1);
            const filled = Math.floor(ratio * width);
            const empty = width - filled;
            const bar = `${A.SUCCESS}${'█'.repeat(filled)}${A.RESET}${A.DIM}${'░'.repeat(empty)}${A.RESET}`;
            const percent = Math.floor(ratio * 100);
            process.stdout.write(`\r  ${A.BOLD}${label}${A.RESET} [${bar}] ${A.CYAN}${percent}%${A.RESET}`);
            await sleep(50);
        }
        process.stdout.write(`\r  ${A.BOLD}${label}${A.RESET} [${A.SUCCESS}${'█'.repeat(width)}${A.RESET}] ${A.CYAN}100%${A.RESET}\n`);
        process.stdout.write('\x1b[?25h'); // Show cursor
    },

    async pulse(text, colors = [[0, 255, 255], [255, 0, 255]], durationMs = 1000) {
        const end = Date.now() + durationMs;
        while (Date.now() < end) {
            const t = (Math.sin(Date.now() / 200) + 1) / 2;
            const r = Math.round(colors[0][0] + (colors[1][0] - colors[0][0]) * t);
            const g = Math.round(colors[0][1] + (colors[1][1] - colors[0][1]) * t);
            const b = Math.round(colors[0][2] + (colors[1][2] - colors[0][2]) * t);
            process.stdout.write(`\r  ${this._hexToAnsi(r, g, b)}${text}${A.RESET}`);
            await sleep(50);
        }
        process.stdout.write('\r\x1b[K'); // Clear line
        logger.cyber(text);
    },

    progressBar(label, progress, total = 100, width = 30) {
        const p = Math.min(Math.max(progress / total, 0), 1);
        const complete = Math.round(p * width);
        const bar = '█'.repeat(complete) + '░'.repeat(width - complete);
        const pct = Math.round(p * 100);
        process.stdout.write(`\r  ${A.DIM}${label.padEnd(15)}${A.RESET} [${A.PRIMARY}${bar}${A.RESET}] ${A.BOLD}${pct}%${A.RESET}`);
        if (p >= 1) console.log();
    },

    printHeader(title) {
        const bar = '═'.repeat(52);
        console.log(`\n  ${A.DIM}╔${bar}╗${A.RESET}`);
        const center = title.padStart(26 + Math.floor(title.length / 2)).padEnd(52);
        console.log(`  ${A.DIM}║${A.RESET} ${this.gradient(center, [0, 229, 255], [181, 102, 255])} ${A.DIM}║${A.RESET}`);
        console.log(`  ${A.DIM}╚${bar}╝${A.RESET}\n`);
    },

    success(msg) { logger.success(msg); },
    error(msg) { logger.error(msg); },
    warn(msg) { logger.warn(msg); },
    info(msg) { logger.info(msg); },
    cyber(msg) { logger.cyber(msg); }
};

module.exports = { A, TerminalAnimator };
