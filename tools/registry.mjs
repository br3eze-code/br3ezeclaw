// tools/registry.js
// AgentOS - Tool Registry System

// ─── IMPORT TOOL GROUPS ───────────────────────────────

// MikroTik tools
import * as mikrotik from "./mikrotik/index.js";

// Telegram tools
import * as telegram from "./telegram/index.js";

// Database tools
import * as db from "./db/index.js";

// Payment tools
import * as payments from "./payments/index.js";

// System tools
import * as system from "./system/index.js";


// ─── TOOL REGISTRY MAP ───────────────────────────────

export const tools = {
    // NETWORK / MIKROTIK
    ...prefix("mikrotik", mikrotik),

    // TELEGRAM
    ...prefix("telegram", telegram),

    // DATABASE
    ...prefix("db", db),

    // PAYMENTS
    ...prefix("payments", payments),

    // SYSTEM
    ...prefix("system", system)
};


/**
 * PREFIX HELPER
 * Converts:
 *   { createUser }
 * into:
 *   { "mikrotik.createUser": fn }
 */
function prefix(namespace, group) {
    const mapped = {};

    for (const key in group) {
        mapped[`${namespace}.${key}`] = group[key];
    }

    return mapped;
}
