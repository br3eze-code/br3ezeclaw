import Anthropic from "@anthropic-ai/sdk";
import { BaseAdapter } from "./base.adapter.js";

export class ClaudeAdapter extends BaseAdapter {
    constructor(apiKey) {
        super("claude");
        this.client = new Anthropic({ apiKey });
    }

    async generate(prompt, options = {}) {
        const res = await this.client.messages.create({
            model: options.model || "claude-3-5-sonnet",
            max_tokens: options.max_tokens || 1024,
            messages: [{ role: "user", content: prompt }]
        });

        return {
            text: res.content[0].text,
            provider: "claude"
        };
    }
    async generateImage(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateImageStream(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateImageFile(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateImageFileStream(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateVideo(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateVideoStream(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateVideoFile(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateVideoFileStream(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateQrCode(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateQrCodeStream(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateQrCodeFile(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateQrCodeFileStream(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generatePDF(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generatePDFStream(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generatePDFFile(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generatePDFFileStream(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateTextFile(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateTextFileStream(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateTools(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateToolsStream(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateNote(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateNoteStream(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateFile(prompt, options = {}) {
        throw new Error("Not implemented");
    }
    async generateFileStream(prompt, options = {}) {
        throw new Error("Not implemented");
    }
}