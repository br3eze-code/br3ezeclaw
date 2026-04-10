/**
 * AgentOS Tool Handler: mikrotik.user.add
 * Creates or updates a hotspot user on MikroTik RouterOS
 */

const { getMikroTikClient } = require('../../../../core/mikrotik');
const { logger } = require('../../../../core/logger');

async function handler(context, input) {
    const { username, password, profile, sharedUsers = 1 } = input;
    const actualPassword = password || username;

    logger.info(`Tool mikrotik.user.add: ${username} (${profile})`);

    try {
        const mikrotik = await getMikroTikClient();

        // Check if user exists
        const existing = await mikrotik.conn
            .menu('/ip/hotspot/user')
            .where('name', username)
            .get();

        let action;

        if (existing.length > 0) {
            // Update existing user
            await mikrotik.conn
                .menu('/ip/hotspot/user')
                .update(existing[0]['.id'], {
                    password: actualPassword,
                    profile: profile,
                    'shared-users': sharedUsers.toString(),
                    disabled: 'no'
                });
            action = 'updated';
        } else {
            // Create new user
            await mikrotik.conn
                .menu('/ip/hotspot/user')
                .add({
                    name: username,
                    password: actualPassword,
                    profile: profile,
                    'shared-users': sharedUsers.toString(),
                    disabled: 'no'
                });
            action = 'created';
        }

        return {
            success: true,
            action,
            username,
            profile,
            message: `User ${username} ${action} successfully with profile ${profile}`,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        logger.error(`Tool mikrotik.user.add failed:`, error);

        // Determine error code
        let code = 'UNKNOWN_ERROR';
        if (error.message.includes('cannot login')) {
            code = 'CONNECTION_FAILED';
        } else if (error.message.includes('invalid profile')) {
            code = 'INVALID_PROFILE';
        }

        throw {
            code,
            message: error.message,
            tool: 'mikrotik.user.add',
            input: { username, profile } // Don't log password
        };
    }
}

// Additional exports for advanced usage
handler.validate = async (input) => {
    // Pre-validation logic
    if (input.username === 'admin') {
        throw new Error('Username "admin" is reserved');
    }
    return true;
};

handler.dryRun = async (input) => {
    // Simulate execution without side effects
    return {
        wouldCreate: true,
        estimatedTime: 500,
        sideEffects: ['user record', 'hotspot binding']
    };
};

module.exports = { handler };