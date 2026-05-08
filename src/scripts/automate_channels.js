'use strict';
/**
 * Automate Channel Standardization
 * Ensures all channels include metadata and self-register.
 */

const fs = require('fs');
const path = require('path');

const channelsDir = path.join(__dirname, '../core/channels');
const files = fs.readdirSync(channelsDir).filter(f => f.endsWith('Channel.js') && f !== 'BaseChannel.js');

const metadataMap = {
    'TelegramChannel.js': {
        name: 'Telegram',
        description: 'Global reach via Telegram bots',
        configFields: [
            { name: 'token', type: 'password', message: 'Telegram Bot Token:', required: true }
        ]
    },
    'WhatsappChannel.js': {
        name: 'WhatsApp',
        description: 'Native WhatsApp integration via Baileys',
        configFields: [
            { name: 'authStateFolder', type: 'input', message: 'Auth State Folder:', default: './data/whatsapp_auth' }
        ]
    },
    'SlackChannel.js': {
        name: 'Slack',
        description: 'Team collaboration via Slack Bolt',
        configFields: [
            { name: 'token', type: 'password', message: 'Slack Bot Token (xoxb-):', required: true },
            { name: 'appToken', type: 'password', message: 'Slack App Token (xapp-):', required: true }
        ]
    },
    'DiscordChannel.js': {
        name: 'Discord',
        description: 'Community alerts via Discord.js',
        configFields: [
            { name: 'token', type: 'password', message: 'Discord Bot Token:', required: true }
        ]
    },
    'SMSChannel.js': {
        name: 'SMS',
        description: 'Direct SMS delivery via local gateway or Twilio',
        configFields: [
            { name: 'gatewayUrl', type: 'input', message: 'Gateway URL:', default: 'http://localhost:8080' }
        ]
    },
    'EmailChannel.js': {
        name: 'Email',
        description: 'Professional comms via SMTP/IMAP',
        configFields: [
            { name: 'host', type: 'input', message: 'SMTP Host:', default: 'smtp.gmail.com' },
            { name: 'user', type: 'input', message: 'Email User:', required: true },
            { name: 'pass', type: 'password', message: 'Email Pass:', required: true }
        ]
    },
    'USSDChannel.js': {
        name: 'USSD',
        description: 'Offline reach via GSM gateways',
        configFields: [
            { name: 'port', type: 'input', message: 'Modem Port:', default: '/dev/ttyUSB0' }
        ]
    }
};

console.log(`Analyzing ${files.length} channels...`);

for (const file of files) {
    const filePath = path.join(channelsDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    const meta = metadataMap[file] || { name: file.replace('Channel.js', ''), description: 'Messaging channel', configFields: [] };
    
    let modified = false;
    const channelKey = file.replace('Channel.js', '').toLowerCase();
    const className = file.replace('.js', '');

    // 1. Ensure BaseChannel inheritance
    if (!content.includes('extends BaseChannel')) {
        content = content.replace(/class (\w+) {/, 'class $1 extends BaseChannel {');
        if (!content.includes("require('./BaseChannel')")) {
            content = "const { BaseChannel } = require('./BaseChannel');\n" + content;
        }
        modified = true;
    }

    // 2. Insert Metadata
    const metadataStr = `
    static getMetadata() {
        return {
            name: '${meta.name}',
            description: '${meta.description}',
            configFields: ${JSON.stringify(meta.configFields, null, 8)}
        };
    }
`;

    if (!content.includes('static getMetadata()')) {
        content = content.replace(/(class \w+ extends BaseChannel {)/, `$1${metadataStr}`);
        modified = true;
    }

    // 3. Ensure self-registration
    if (!content.includes('BaseChannel.register')) {
        content += `\nBaseChannel.register('${channelKey}', ${className});\n`;
        modified = true;
    }

    if (modified) {
        fs.writeFileSync(filePath, content);
        console.log(`[FIXED] ${file}`);
    } else {
        console.log(`[OK]    ${file}`);
    }
}

console.log('Automation complete.');
