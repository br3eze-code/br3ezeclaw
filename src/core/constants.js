'use strict';

/**
 * AgentOS Constants — Premium ANSI Palette
 */
const A = {
    RESET: '\x1b[0m',
    BOLD: '\x1b[1m',
    DIM: '\x1b[2m',
    ITALIC: '\x1b[3m',
    UNDERLINE: '\x1b[4m',
    REVERSE: '\x1b[7m',
    
    // Core Palette
    PRIMARY: '\x1b[38;5;39m',   // Deep Sky Blue
    SECONDARY: '\x1b[38;5;147m', // Light Slate Blue
    SUCCESS: '\x1b[38;5;82m',   // Chartreuse
    ERROR: '\x1b[38;5;196m',     // Red
    WARN: '\x1b[38;5;214m',      // Orange
    INFO: '\x1b[38;5;45m',       // Turquoise
    
    // Cyber Theme
    NEON_CYAN: '\x1b[38;5;51m',
    CYBER_PURPLE: '\x1b[38;5;135m',
    HOT_PINK: '\x1b[38;5;201m',
    MATRIX_GREEN: '\x1b[38;5;46m',
    GOLD: '\x1b[38;5;220m',
    
    // Backgrounds
    BG_CYBER: '\x1b[48;5;234m',
};

module.exports = { A };
