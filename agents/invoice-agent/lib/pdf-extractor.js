'use strict';
/**
 * pdf-extractor.js — Invoice PDF text extraction
 *
 * Priority order:
 *   1. pdf-parse  (pure JS, works everywhere — install: npm i pdf-parse)
 *   2. pdfjs-dist (Mozilla PDF.js — heavier but more accurate)
 *   3. poppler    (system binary `pdftotext` — fastest if available)
 *   4. Raw byte grep (last resort — pulls ASCII text from raw buffer)
 */

const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/* ─── Try loading optional PDF libraries ──────────────────────────── */
/* ─── PDF libraries (lazy loaded) ────────────────────────────────── */
let pdfParse;
let pdfjsLib;

/* ------------------------------------------------------------------ */
/* Public API                                                           */
/* ------------------------------------------------------------------ */

/**
 * Extract plain text from a PDF buffer or file path.
 *
 * @param {Buffer|string} input  - PDF buffer, local file path, or http(s) URL
 * @returns {Promise<{ text: string, pages: number, method: string }>}
 */
async function extractPDF(input) {
    const buffer = await _toBuffer(input);

    // 1. pdf-parse (best for most invoices)
    if (pdfParse === undefined) {
        try { pdfParse = require('pdf-parse'); } catch (e) { pdfParse = null; }
    }

    if (pdfParse) {
        try {
            const data = await pdfParse(buffer, { max: 0 });
            return { text: _clean(data.text), pages: data.numpages, method: 'pdf-parse' };
        } catch (err) {
            console.warn('[pdf-extractor] pdf-parse failed:', err.message);
        }
    }

    // 2. pdfjs-dist
    if (pdfjsLib === undefined) {
        try { pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js'); } catch (e) { pdfjsLib = null; }
    }

    if (pdfjsLib) {
        try {
            const result = await _extractViaPdfjs(buffer);
            return { ...result, method: 'pdfjs-dist' };
        } catch (err) {
            console.warn('[pdf-extractor] pdfjs-dist failed:', err.message);
        }
    }

    // 3. system pdftotext (poppler)
    try {
        const result = await _extractViaPdftotext(buffer);
        return { ...result, method: 'pdftotext' };
    } catch (err) {
        console.warn('[pdf-extractor] pdftotext failed:', err.message);
    }

    // 4. Raw text grep fallback
    const text = _rawExtract(buffer);
    return { text, pages: 0, method: 'raw-fallback' };
}

/**
 * Parse invoice-specific fields from extracted text.
 * Returns a structured object for downstream processing.
 *
 * @param {string} text
 * @returns {{ invoiceNumber: string|null, date: string|null, amount: string|null,
 *             vendor: string|null, lineItems: Array, raw: string }}
 */
function parseInvoiceFields(text) {
    return {
        invoiceNumber: _matchFirst(text, [
            /invoice\s*#?\s*[:\-]?\s*([A-Z0-9\-]+)/i,
            /inv\.?\s*no\.?\s*[:\-]?\s*([A-Z0-9\-]+)/i
        ]),
        date: _matchFirst(text, [
            /(?:invoice\s+)?date\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
            /dated?\s*[:\-]?\s*(\w+ \d{1,2},?\s*\d{4})/i
        ]),
        amount: _matchFirst(text, [
            /total\s+(?:amount\s+)?(?:due\s+)?[:\-]?\s*\$?([\d,]+\.?\d{0,2})/i,
            /amount\s+payable\s*[:\-]?\s*\$?([\d,]+\.?\d{0,2})/i,
            /grand\s+total\s*[:\-]?\s*\$?([\d,]+\.?\d{0,2})/i
        ]),
        vendor: _matchFirst(text, [
            /(?:from|vendor|billed?\s+by|supplier)\s*[:\-]?\s*([^\n]{3,60})/i
        ]),
        lineItems: _extractLineItems(text),
        raw: text
    };
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                     */
/* ------------------------------------------------------------------ */

async function _toBuffer(input) {
    if (Buffer.isBuffer(input)) return input;

    if (typeof input === 'string') {
        if (/^https?:\/\//i.test(input)) {
            return _fetchUrl(input);
        }
        if (/^gs:\/\//i.test(input)) {
            return _fetchGCS(input);
        }
        // Local path
        return fs.promises.readFile(input);
    }

    throw new TypeError('[pdf-extractor] input must be Buffer, file path, HTTP URL, or GCS URL');
}

function _fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? require('https') : require('http');
        const chunks = [];
        mod.get(url, res => {
            if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode} fetching PDF`));
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
    });
}

async function _fetchGCS(gsUri) {
    // Requires @google-cloud/storage installed
    const { Storage } = require('@google-cloud/storage');
    const [, , bucket, ...parts] = gsUri.replace('gs://', '').split('/');
    const file   = new Storage().bucket(bucket).file(parts.join('/'));
    const chunks = [];
    for await (const chunk of file.createReadStream()) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function _extractViaPdfjs(buffer) {
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf  = await loadingTask.promise;
    const texts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page    = await pdf.getPage(i);
        const content = await page.getTextContent();
        texts.push(content.items.map(item => item.str).join(' '));
    }
    return { text: _clean(texts.join('\n')), pages: pdf.numPages };
}

function _extractViaPdftotext(buffer) {
    return new Promise((resolve, reject) => {
        const tmp = path.join(require('os').tmpdir(), `br3eze_pdf_${Date.now()}.pdf`);
        fs.writeFileSync(tmp, buffer);
        execFile('pdftotext', [tmp, '-'], (err, stdout) => {
            fs.unlink(tmp, () => {});
            if (err) return reject(err);
            resolve({ text: _clean(stdout), pages: 0 });
        });
    });
}

function _rawExtract(buffer) {
    // Pull printable ASCII runs ≥ 4 chars from raw bytes
    const str   = buffer.toString('latin1');
    const words = str.match(/[ -~]{4,}/g) || [];
    return _clean(words.join(' '));
}

function _clean(text) {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function _matchFirst(text, patterns) {
    for (const re of patterns) {
        const m = text.match(re);
        if (m?.[1]) return m[1].trim();
    }
    return null;
}

function _extractLineItems(text) {
    const items = [];
    // Match lines like: "Widget Pro   x3   $150.00"
    const lineRe = /(.{5,40})\s+(?:x\s*)?(\d+)\s+\$?([\d,]+\.\d{2})/g;
    let m;
    while ((m = lineRe.exec(text)) !== null) {
        items.push({ description: m[1].trim(), quantity: parseInt(m[2], 10), amount: m[3] });
    }
    return items;
}

module.exports = { extractPDF, parseInvoiceFields };
