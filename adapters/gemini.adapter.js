import { BaseAdapter } from "./base.adapter.js";
import axios from "axios";

export class GeminiAdapter extends BaseAdapter {
    constructor(apiKey) {
        super("gemini");
        this.apiKey = apiKey;
    }

    async generate(prompt, options = {}) {
        const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${this.apiKey}`,
            {
                contents: [{ parts: [{ text: prompt }] }]
            }
        );

        return {
            text: res.data.candidates?.[0]?.content?.parts?.[0]?.text || "",
            provider: "gemini"
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