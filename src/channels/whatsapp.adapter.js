'use strict';

const axios = require('axios');

class WhatsAppAdapter {
    constructor(config) {
        this.apiUrl = config.apiUrl; // Meta Business API
        this.accessToken = config.accessToken;
        this.phoneNumberId = config.phoneNumberId;
    }

    async send(phoneNumber, message) {
        const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;
        
        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: this.normalizePhone(phoneNumber),
            type: typeof message === 'string' ? 'text' : message.type
        };

        if (typeof message === 'string') {
            payload.text = { body: message, preview_url: false };
        } else if (message.type === 'text') {
            payload.text = message.text;
        } else if (message.type === 'document') {
            payload.document = message.document;
        }

        await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'Content-Type': 'application/json'
            }
        });
    }

    format(template, data) {
        switch (template) {
            case 'pairing_code':
                return {
                    type: 'text',
                    text: {
                        body: `*AgentOS Router Pairing*\n\n` +
                              `Code: *${data.code}*\n` +
                              `Location: ${data.location}\n` +
                              `Expires: ${data.expiresIn} min\n\n` +
                              `Instructions:\n` +
                              `1. Open Winbox/WebFig\n` +
                              `2. Open New Terminal\n` +
                              `3. Paste the script (sent as document)\n\n` +
                              `Or manually run:\n` +
                              `/system/script/run agentos-onboard code=${data.code}`,
                        preview_url: false
                    },
                    document: {
                        filename: `agentos-pair-${data.code}.rsc`,
                        caption: 'RouterOS onboarding script'
                    }
                };
                
            case 'pairing_success':
                return {
                    type: 'text',
                    text: {
                        body: `✅ *Router Paired Successfully*\n\n` +
                              `Name: ${data.identity}\n` +
                              `ID: ${data.routerId}\n` +
                              `Model: ${data.model}\n` +
                              `Paired: ${new Date(data.pairedAt).toLocaleString()}`
                    }
                };
                
            default:
                return { type: 'text', text: { body: JSON.stringify(data) } };
        }
    }

    normalizePhone(phone) {
        return phone.replace(/\D/g, '').replace(/^0/, '263'); // Default to ZW
    }
}

module.exports = WhatsAppAdapter;
