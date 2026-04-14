'use strict';

const OpenAI          = require('openai');
const { BaseAdapter } = require('./base.adapter');

class OpenAIAdapter extends BaseAdapter {
    constructor(apiKey) {
        super('openai');
        this.client = new OpenAI({ apiKey });
    }

    async generate(prompt, options = {}) {
        const res = await this.client.chat.completions.create({
            model:       options.model       || 'gpt-4o-mini',
            messages:    [{ role: 'user', content: prompt }],
            temperature: options.temperature || 0.7
        });
        return { text: res.choices[0].message.content, provider: 'openai' };
    }

    async generateStream(prompt, options = {}) {
        return this.client.chat.completions.create({
            model:    options.model || 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            stream:   true
        });
    }
}

module.exports = OpenAIAdapter;
