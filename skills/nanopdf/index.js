
// skills/nanopdf/index.js
const puppeteer = require('puppeteer-core');
const { PDFDocument, PDFPage, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');

class NanoPDFSkill {
  constructor() {
    this.browser = null;
    this.templates = new Map();
    this.cacheDir = './cache/pdf';
  }

  async initialize() {
    await fs.mkdir(this.cacheDir, { recursive: true });
    
    // Launch puppeteer for HTML-to-PDF
    this.browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Load built-in templates
    await this.loadTemplates();
  }

  async loadTemplates() {
    const templatesDir = path.join(__dirname, 'templates');
    try {
      const files = await fs.readdir(templatesDir);
      for (const file of files) {
        if (file.endsWith('.html')) {
          const name = path.basename(file, '.html');
          const content = await fs.readFile(path.join(templatesDir, file), 'utf8');
          this.templates.set(name, content);
        }
      }
    } catch {
      // No templates directory
    }
  }

  async execute(params, context) {
    const { action, ...config } = params;

    switch (action) {
      case 'create':
        return this.createPDF(config, context);
      case 'merge':
        return this.mergePDFs(config, context);
      case 'split':
        return this.splitPDF(config, context);
      case 'extract':
        return this.extractFromPDF(config, context);
      case 'convert':
        return this.convertPDF(config, context);
      case 'fill':
        return this.fillForm(config, context);
      case 'sign':
        return this.signPDF(config, context);
      case 'compress':
        return this.compressPDF(config, context);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  async createPDF({ template, data, options = {} }, context) {
    let html;

    if (this.templates.has(template)) {
      html = this.renderTemplate(this.templates.get(template), data);
    } else if (template.startsWith('<')) {
      html = this.renderTemplate(template, data);
    } else {
      // Load from file or URL
      html = await this.loadTemplate(template, data);
    }

    const page = await this.browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: options.pageSize || 'A4',
      landscape: options.orientation === 'landscape',
      margin: options.margins || { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
      displayHeaderFooter: !!(options.header || options.footer),
      headerTemplate: options.header || '',
      footerTemplate: options.footer || '',
      printBackground: true
    });

    await page.close();

    // Add watermark if specified
    if (options.watermark) {
      return this.addWatermark(pdfBuffer, options.watermark);
    }

    return this.saveAndReturn(pdfBuffer, 'generated');
  }

  renderTemplate(template, data) {
    // Simple template engine
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return data?.[key] !== undefined ? String(data[key]) : match;
    });
  }

  async loadTemplate(source, data) {
    if (source.startsWith('http')) {
      const response = await fetch(source);
      return this.renderTemplate(await response.text(), data);
    }
    const content = await fs.readFile(source, 'utf8');
    return this.renderTemplate(content, data);
  }

  async mergePDFs({ files }, context) {
    const mergedPdf = await PDFDocument.create();

    for (const filePath of files) {
      const pdfBytes = await fs.readFile(filePath);
      const pdf = await PDFDocument.load(pdfBytes);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach(page => mergedPdf.addPage(page));
    }

    const pdfBytes = await mergedPdf.save();
    return this.saveAndReturn(Buffer.from(pdfBytes), 'merged');
  }

  async splitPDF({ file, pages }, context) {
    const pdfBytes = await fs.readFile(file);
    const pdf = await PDFDocument.load(pdfBytes);
    
    const results = [];
    
    for (const [index, pageRange] of pages.entries()) {
      const newPdf = await PDFDocument.create();
      const pageIndices = this.parsePageRange(pageRange, pdf.getPageCount());
      
      const copiedPages = await newPdf.copyPages(pdf, pageIndices);
      copiedPages.forEach(page => newPdf.addPage(page));
      
      const bytes = await newPdf.save();
      const result = await this.saveAndReturn(Buffer.from(bytes), `split-${index + 1}`);
      results.push(result);
    }

    return { success: true, files: results };
  }

  parsePageRange(range, totalPages) {
    if (range === 'all') return Array.from({ length: totalPages }, (_, i) => i);
    
    const indices = [];
    const parts = range.split(',');
    
    for (const part of parts) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number);
        for (let i = start - 1; i < end; i++) {
          if (i < totalPages) indices.push(i);
        }
      } else {
        const idx = Number(part) - 1;
        if (idx < totalPages) indices.push(idx);
      }
    }
    
    return indices;
  }

  async extractFromPDF({ file, type = 'text' }, context) {
    const pdfBytes = await fs.readFile(file);
    const pdf = await PDFDocument.load(pdfBytes);

    switch (type) {
      case 'text':
        const texts = [];
        for (let i = 0; i < pdf.getPageCount(); i++) {
          const page = pdf.getPage(i);
          const text = await page.getTextContent?.() || { items: [] };
          texts.push(text.items.map(item => item.str).join(' '));
        }
        return { success: true, pages: texts };
        
      case 'images':
        // Extract embedded images
        const images = [];
        // Implementation depends on pdf-lib capabilities
        return { success: true, images };
        
      case 'metadata':
        return {
          success: true,
          metadata: {
            title: pdf.getTitle(),
            author: pdf.getAuthor(),
            subject: pdf.getSubject(),
            creator: pdf.getCreator(),
            keywords: pdf.getKeywords(),
            producer: pdf.getProducer(),
            creationDate: pdf.getCreationDate(),
            modificationDate: pdf.getModificationDate(),
            pageCount: pdf.getPageCount()
          }
        };
        
      default:
        throw new Error(`Unknown extract type: ${type}`);
    }
  }

  async convertPDF({ file, format = 'png', dpi = 150 }, context) {
    const page = await this.browser.newPage();
    
    // Load PDF
    const pdfPath = path.resolve(file);
    await page.goto(`file://${pdfPath}`, { waitUntil: 'networkidle0' });

    // Convert to image
    const screenshot = await page.screenshot({
      type: format === 'jpg' ? 'jpeg' : format,
      fullPage: true
    });

    await page.close();
    
    return this.saveAndReturn(screenshot, `converted-${format}`, format);
  }

  async fillForm({ file, fields }, context) {
    const pdfBytes = await fs.readFile(file);
    const pdf = await PDFDocument.load(pdfBytes);
    
    const form = pdf.getForm();
    
    for (const [name, value] of Object.entries(fields)) {
      try {
        const field = form.getTextField(name);
        if (field) field.setText(String(value));
      } catch {
        try {
          const checkbox = form.getCheckBox(name);
          if (checkbox) {
            if (value) checkbox.check();
            else checkbox.uncheck();
          }
        } catch {
          try {
            const dropdown = form.getDropdown(name);
            if (dropdown) dropdown.select(value);
          } catch {
            // Field not found or wrong type
          }
        }
      }
    }

    form.flatten();
    
    const bytes = await pdf.save();
    return this.saveAndReturn(Buffer.from(bytes), 'filled');
  }

  async signPDF({ file, signature, position }, context) {
    const pdfBytes = await fs.readFile(file);
    const pdf = await PDFDocument.load(pdfBytes);
    
    // Load signature image
    let sigImage;
    if (signature.startsWith('data:image')) {
      const base64 = signature.split(',')[1];
      sigImage = await pdf.embedPng(Buffer.from(base64, 'base64'));
    } else {
      const sigBytes = await fs.readFile(signature);
      sigImage = signature.endsWith('.png') 
        ? await pdf.embedPng(sigBytes)
        : await pdf.embedJpg(sigBytes);
    }

    const pages = pdf.getPages();
    const firstPage = pages[0];
    
    const { x = 100, y = 100, width = 150, height = 50 } = position || {};
    
    firstPage.drawImage(sigImage, {
      x,
      y: firstPage.getHeight() - y - height,
      width,
      height
    });

    const bytes = await pdf.save();
    return this.saveAndReturn(Buffer.from(bytes), 'signed');
  }

  async compressPDF({ file, quality = 'medium' }, context) {
    const pdfBytes = await fs.readFile(file);
    const pdf = await PDFDocument.load(pdfBytes);
    
    // Compression settings based on quality
    const settings = {
      low: { useObjectStreams: true, addDefaultPage: false },
      medium: { useObjectStreams: true, preserveExistingEncryption: false },
      high: { useObjectStreams: true, objectsPerTick: 10 }
    };

    const bytes = await pdf.save(settings[quality] || settings.medium);
    
    const originalSize = pdfBytes.length;
    const compressedSize = bytes.length;
    
    const result = await this.saveAndReturn(Buffer.from(bytes), 'compressed');
    
    return {
      ...result,
      compression: {
        original: originalSize,
        compressed: compressedSize,
        ratio: ((1 - compressedSize / originalSize) * 100).toFixed(2) + '%'
      }
    };
  }

  async addWatermark(pdfBuffer, text) {
    const pdf = await PDFDocument.load(pdfBuffer);
    const pages = pdf.getPages();
    const { width, height } = pages[0].getSize();
    
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontSize = 50;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    
    for (const page of pages) {
      page.drawText(text, {
        x: (width - textWidth) / 2,
        y: height / 2,
        size: fontSize,
        font,
        color: rgb(0.5, 0.5, 0.5),
        opacity: 0.3,
        rotate: { angle: 45 * (Math.PI / 180), type: 'degrees' }
      });
    }

    const bytes = await pdf.save();
    return bytes;
  }

  async saveAndReturn(buffer, suffix, ext = 'pdf') {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const filename = `${suffix}-${id}.${ext}`;
    const filepath = path.join(this.cacheDir, filename);
    
    await fs.writeFile(filepath, buffer);
    
    // Auto-cleanup after 24 hours
    setTimeout(() => {
      fs.unlink(filepath).catch(() => {});
    }, 86400000);

    return {
      success: true,
      url: `/cache/pdf/${filename}`,
      filename,
      size: buffer.length,
      pages: ext === 'pdf' ? await this.getPageCount(buffer) : undefined
    };
  }

  async getPageCount(buffer) {
    try {
      const pdf = await PDFDocument.load(buffer);
      return pdf.getPageCount();
    } catch {
      return undefined;
    }
  }

  validate(params) {
    if (params.action === 'create') {
      return !!params.template;
    }
    if (['merge', 'split', 'extract', 'convert', 'fill', 'sign', 'compress'].includes(params.action)) {
      return !!params.file || (params.files && params.files.length > 0);
    }
    return true;
  }

  async destroy() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

module.exports = new NanoPDFSkill();
