import { BaseAdapter } from "./base.adapter.js";
import axios from "axios";

export class LocalLLMAdapter extends BaseAdapter {
    constructor(endpoint = "http://localhost:11434") {
        super("local");
        this.endpoint = endpoint;
    }

    async generate(prompt, options = {}) {
        const res = await axios.post(`${this.endpoint}/api/generate`, {
            model: options.model || "llama3",
            prompt,
            stream: false
        });

        return {
            text: res.data.response,
            provider: "local"
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