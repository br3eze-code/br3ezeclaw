import OpenAI from "openai";
import { BaseAdapter } from "./base.adapter.js";

export class OpenAIAdapter extends BaseAdapter {
  constructor(apiKey) {
    super("openai");
    this.client = new OpenAI({ apiKey });
  }

  async generate(prompt, options = {}) {
    const res = await this.client.chat.completions.create({
      model: options.model || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: options.temperature || 0.7
    });

    return {
      text: res.choices[0].message.content,
      provider: "openai"
    };
  }
  async generateFile(prompt, options = {}) {
    throw new Error("Not implemented");
  }
  async generateFileStream(prompt, options = {}) {
    throw new Error("Not implemented");
  }
  async generateAudio(prompt, options = {}) {
    throw new Error("Not implemented");
  }
  async generateAudioStream(prompt, options = {}) {
    throw new Error("Not implemented");
  }
  async generateVideo(prompt, options = {}) {
    throw new Error("Not implemented");
  }
  async generateVideoStream(prompt, options = {}) {
    throw new Error("Not implemented");
  }
  async generateImage(prompt, options = {}) {
    throw new Error("Not implemented");
  }
  async generateImageStream(prompt, options = {}) {
    throw new Error("Not implemented");
  }
  async generateEmbeddings(prompt, options = {}) {
    throw new Error("Not implemented");
  }
  async generateEmbeddingsStream(prompt, options = {}) {
    throw new Error("Not implemented");
  }
  async generateCode(prompt, options = {}) {
    throw new Error("Not implemented");
  }
  async generateCodeStream(prompt, options = {}) {
    throw new Error("Not implemented");
  }
  async generateCodeFile(prompt, options = {}) {
    throw new Error("Not implemented");
  }
  async generateCodeFileStream(prompt, options = {}) {
    throw new Error("Not implemented");
  }
  async generateAudioFile(prompt, options = {}) {
    throw new Error("Not implemented");
  }
  async generateAudioFileStream(prompt, options = {}) {
    throw new Error("Not implemented");
  }
  async generateImageFile(prompt, options = {}) {
    throw new Error("Not implemented");
  }
  async generateImageFileStream(prompt, options = {}) {
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
}