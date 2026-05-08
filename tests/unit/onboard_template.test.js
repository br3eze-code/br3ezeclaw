const { generateSetupScript } = require('../../src/core/onboard');

describe('Onboard Template Generation', () => {
    const mockEnv = {
        AGENTOS_NODE_URL: 'http://1.2.3.4:3000',
        TELEGRAM_BOT_TOKEN: 'test_token',
        TELEGRAM_CHAT_ID: 'test_chat_id'
    };

    test('should generate a script with correct dynamic values', () => {
        const script = generateSetupScript(mockEnv);
        
        expect(script).toContain('http://1.2.3.4:3000/api/event/login');
        expect(script).toContain('test_token');
        expect(script).toContain('test_chat_id');
        expect(script).toContain('address=1.2.3.4');
    });

    test('should not contain undefined strings', () => {
        const script = generateSetupScript(mockEnv);
        expect(script).not.toContain('undefined');
    });

    test('should have valid login-by values', () => {
        const script = generateSetupScript(mockEnv);
        // Correct is mac,cookie or similar, NOT mac-cookie
        expect(script).not.toContain('login-by=mac-cookie');
        expect(script).toContain('login-by=http-chap,http-pap,trial,mac,cookie');
    });
});
