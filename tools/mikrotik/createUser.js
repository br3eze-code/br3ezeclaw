// tools/mikrotik/createUser.js
// MikroTik Hotspot User Creation Tool

import { getRouterConnection } from "./connection.js";

/**
 * TOOL: mikrotik.createUser
 * Creates a hotspot user on MikroTik router
 */

export async function createUser({ name, password, profile = "default", context }) {
    if (!name || !password) {
        throw new Error("Missing required fields: name or password");
    }

    const conn = await getRouterConnection();

    try {
        // 1. Check if user already exists
        const existing = await conn.write("/ip/hotspot/user/print", [
            `?name=${name}`
        ]);

        if (existing && existing.length > 0) {
            return {
                status: "exists",
                message: `User ${name} already exists`
            };
        }

        // 2. Create user
        await conn.write("/ip/hotspot/user/add", [
            `=name=${name}`,
            `=password=${password}`,
            `=profile=${profile}`
        ]);

        return {
            status: "created",
            user: name,
            profile
        };

    } catch (err) {
        throw new Error("MikroTik createUser failed: " + err.message);
    }
}