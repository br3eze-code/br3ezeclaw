'use strict';

const axios           = require('axios');
const { BaseAdapter } = require('./base.adapter');

class LocalLLMAdapter extends BaseAdapter {
    constructor(endpoint = 'http://localhost:19876') {
        super('local');
        this.endpoint = endpoint;
    }

    async generate(prompt, options = {}) {
        const res = await axios.post(`${this.endpoint}/api/generate`, {
            model:  options.model || 'llama3',
            prompt,
            stream: false
        });
        return { text: res.data.response, provider: 'local' };
    }
}

module.exports = LocalLLMAdapter;
