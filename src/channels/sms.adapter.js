'use strict';

const axios = require('axios');

class SMSAdapter {
    constructor(config) {
        this.provider = config.provider; // 'twilio', 'africastalking', 'clickatell'
        this.config = config;
    }

    async send(phoneNumber, message) {
        const text = typeof message === 'string' ? message : message.text?.body || message.text;
        
        switch (this.provider) {
            case 'twilio':
                return this.sendTwilio(phoneNumber, text);
            case 'africastalking':
                return this.sendAT(phoneNumber, text);
            default:
                throw new Error(`Unknown SMS provider: ${this.provider}`);
        }
    }

    async sendTwilio(to, body) {
        const { default: twilio } = await import('twilio');
        const client = twilio(this.config.accountSid, this.config.authToken);
        return client.messages.create({
            body,
            from: this.config.from,
            to
        });
    }

    format(template, data) {
        // SMS is text-only, short and simple
        switch (template) {
            case 'pairing_code':
                return `AgentOS Pair Code: ${data.code}. ` +
                       `Expires ${data.expiresIn}min. ` +
                       `Run on router: /system/script/run agentos-onboard code=${data.code}`;
                       
            case 'pairing_success':
                return `Router ${data.identity} paired! ` +
                       `ID: ${data.routerId.slice(0,8)}... ` +
                       `Manage: ${process.env.AGENTOS_DASHBOARD_URL}`;
                       
            default:
                return JSON.stringify(data);
        }
    }
}

module.exports = SMSAdapter;
