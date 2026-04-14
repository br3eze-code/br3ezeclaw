// adapters/base.adapter.js
'use strict';

class BaseAdapter {
    constructor(name) {
        this.name = name;
    }
    async generate(prompt, options = {})            { throw new Error(`${this.name} must implement generate()`); }
    async generateStream(prompt, options = {})      { throw new Error(`${this.name} must implement generateStream()`); }
    async generateImage(prompt, options = {})       { throw new Error(`${this.name} must implement generateImage()`); }
    async generateImageStream(prompt, options = {}) { throw new Error(`${this.name} must implement generateImageStream()`); }
    async generateAudio(prompt, options = {})       { throw new Error(`${this.name} must implement generateAudio()`); }
    async generateAudioStream(prompt, options = {}) { throw new Error(`${this.name} must implement generateAudioStream()`); }
    async generateVideo(prompt, options = {})       { throw new Error(`${this.name} must implement generateVideo()`); }
    async generateVideoStream(prompt, options = {}) { throw new Error(`${this.name} must implement generateVideoStream()`); }
    async generateFile(prompt, options = {})        { throw new Error(`${this.name} must implement generateFile()`); }
    async generateFileStream(prompt, options = {})  { throw new Error(`${this.name} must implement generateFileStream()`); }
}

module.exports = { BaseAdapter };

export class BaseAdapter {
    constructor(name) {
        this.name = name;
    }

    async generate(prompt, options = {}) {
        throw new Error(`${this.name} must implement generate()`);
    }
    async generateStream(prompt, options = {}) {
        throw new Error(`${this.name} must implement generateStream()`);
    }
    async generateImage(prompt, options = {}) {
        throw new Error(`${this.name} must implement generateImage()`);
    }
    async generateImageStream(prompt, options = {}) {
        throw new Error(`${this.name} must implement generateImageStream()`);
    }
    async generateAudio(prompt, options = {}) {
        throw new Error(`${this.name} must implement generateAudio()`);
    }
    async generateAudioStream(prompt, options = {}) {
        throw new Error(`${this.name} must implement generateAudioStream()`);
    }
    async generateVideo(prompt, options = {}) {
        throw new Error(`${this.name} must implement generateVideo()`);
    }
    async generateVideoStream(prompt, options = {}) {
        throw new Error(`${this.name} must implement generateVideoStream()`);
    }
    async generateFile(prompt, options = {}) {
        throw new Error(`${this.name} must implement generateFile()`);
    }
    async generateFileStream(prompt, options = {}) {
        throw new Error(`${this.name} must implement generateFileStream()`);
    }
}
