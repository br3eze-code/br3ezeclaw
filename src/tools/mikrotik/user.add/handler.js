/**
 * AgentOS Tool Handler: mikrotik.user.add
 * Creates or updates a hotspot user on MikroTik RouterOS
 */

const { getMikroTikClient } = require('../../../../core/mikrotik');
const { logger } = require('../../../../core/logger');

async function handler(context, input) {
    const { username, profile } = input;
    logger.info(`Tool mikrotik.user.add: ${username} (${profile})`);

    try {
        const mikrotik = await getMikroTikClient();
        
        // Use executeTool to leverage circuit breaker and structured logging
        const result = await mikrotik.executeTool('user.add', input);

        return {
            success: true,
            ...result,
            message: result.message || `User ${username} processed successfully`
        };

    } catch (error) {
        logger.error(`Tool mikrotik.user.add failed:`, error.message);

        throw {
            code: error.code || 'TOOL_EXECUTION_ERROR',
            message: error.message,
            tool: 'mikrotik.user.add',
            input: { username, profile }
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