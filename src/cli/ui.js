'use strict';
/**
 * Terminal UI Helpers — animations, gradients, and spinners.
 * Ported from 36.js §3
 */

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const ANSICodes = {
    RESET: '\x1b[0m',
    BOLD: '\x1b[1m',
    DIM: '\x1b[2m',
    PRIMARY: '\x1b[38;2;0;229;255m', // Neon Cyan
    SUCCESS: '\x1b[38;2;0;255;127m', // Spring Green
    ERROR: '\x1b[38;2;255;50;50m',   // Red
    INFO: '\x1b[38;2;181;102;255m',  // Cyber Purple
    CYBER_PURPLE: '\x1b[38;2;181;102;255m',
    NEON_CYAN: '\x1b[38;2;0;229;255m'
};

const TerminalAnimator = {
    _hexToAnsi(r, g, b) {
        return `\x1b[38;2;${r};${g};${b}m`;
    },

    gradient(text, startRGB, endRGB) {
        let out = '';
        const chars = [...text];
        for (let i = 0; i < chars.length; i++) {
            const r = Math.round(startRGB[0] + (endRGB[0] - startRGB[0]) * (i / chars.length));
            const g = Math.round(startRGB[1] + (endRGB[1] - startRGB[1]) * (i / chars.length));
            const b = Math.round(startRGB[2] + (endRGB[2] - startRGB[2]) * (i / chars.length));
            out += `${this._hexToAnsi(r, g, b)}${chars[i]}`;
        }
        return out + ANSICodes.RESET;
    },

    async showSpinner(message, durationMs = 1000) {
        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        const end = Date.now() + durationMs;
        let i = 0;
        while (Date.now() < end) {
            process.stdout.write(`\r  ${ANSICodes.CYBER_PURPLE}${frames[i % frames.length]}${ANSICodes.RESET} ${message}`);
            await sleep(80);
            i++;
        }
        process.stdout.write(`\r  ${ANSICodes.SUCCESS}✔${ANSICodes.RESET} ${message}\n`);
    },

    async typewriter(text, speed = 15) {
        process.stdout.write('  ');
        for (const ch of text) { process.stdout.write(ch); await sleep(speed); }
        console.log();
    },

    async glitch(text, durationMs = 600) {
        const chars = '!@#$%^&*()_+-=[]{}|;:,.<>?/0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const end = Date.now() + durationMs;
        while (Date.now() < end) {
            const noise = text.split('').map(c => c === ' ' ? ' ' : chars[Math.floor(Math.random() * chars.length)]).join('');
            process.stdout.write(`\r  ${ANSICodes.NEON_CYAN}${noise}${ANSICodes.RESET}`);
            await sleep(50);
        }
        process.stdout.write(`\r  ${ANSICodes.BOLD}${text}${ANSICodes.RESET}\n`);
    },

    async decode(text, speed = 40) {
        const chars = '0123456789ABCDEF';
        let current = '';
        process.stdout.write('  ');
        for (let i = 0; i < text.length; i++) {
            for (let j = 0; j < 5; j++) {
                const rand = chars[Math.floor(Math.random() * chars.length)];
                process.stdout.write(`\r  ${ANSICodes.BOLD}${current}${ANSICodes.NEON_CYAN}${rand}${ANSICodes.RESET}`);
                await sleep(speed / 2);
            }
            current += text[i];
            process.stdout.write(`\r  ${ANSICodes.BOLD}${current}${ANSICodes.RESET}`);
        }
        console.log();
    },

    progressBar(label, progress, total = 100, width = 30) {
        const p = Math.min(Math.max(progress / total, 0), 1);
        const complete = Math.round(p * width);
        const bar = '█'.repeat(complete) + '░'.repeat(width - complete);
        const pct = Math.round(p * 100);
        process.stdout.write(`\r  ${ANSICodes.DIM}${label.padEnd(15)}${ANSICodes.RESET} [${ANSICodes.PRIMARY}${bar}${ANSICodes.RESET}] ${ANSICodes.BOLD}${pct}%${ANSICodes.RESET}`);
        if (p >= 1) console.log();
    },

    printHeader(title) {
        const bar = '═'.repeat(52);
        console.log(`\n  ${ANSICodes.DIM}╔${bar}╗${ANSICodes.RESET}`);
        const center = title.padStart(26 + Math.floor(title.length / 2)).padEnd(52);
        console.log(`  ${ANSICodes.DIM}║${ANSICodes.RESET} ${this.gradient(center, [0, 229, 255], [181, 102, 255])} ${ANSICodes.DIM}║${ANSICodes.RESET}`);
        console.log(`  ${ANSICodes.DIM}╚${bar}╝${ANSICodes.RESET}\n`);
    },
};

module.exports = { TerminalAnimator, ANSICodes };
