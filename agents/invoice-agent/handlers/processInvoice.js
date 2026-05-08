'use strict';
/**
 * processInvoice handler — full invoice processing pipeline
 *
 * 1. Extract text from PDF (multi-strategy, see pdf-extractor.js)
 * 2. Parse invoice fields (number, date, amount, vendor, line items)
 * 3. Delegate planning / validation to Gemini planner agent via A2A
 * 4. Return structured invoice record
 *
 * Capability: process_invoice
 * Signature:  (parameters, session, senderSPIFFE, a2aAdapter)
 */

const { extractPDF, parseInvoiceFields } = require('../lib/pdf-extractor');
const { AIOrchestrator } = require('../../../src/core/ai-orchestrator');

const GEMINI_PLANNER_SPIFFE = 'spiffe://google.adk/agent/gemini-planner';

// Lazy singleton orchestrator for Gemini-driven field validation
let _orchestrator = null;
async function getOrchestrator() {
    if (!_orchestrator) {
        _orchestrator = new AIOrchestrator({
            project: process.env.GOOGLE_CLOUD_PROJECT,
            location: process.env.GEMINI_LOCATION || 'us-central1',
            model:   process.env.GEMINI_MODEL    || 'gemini-2.0-flash-001',
            apiKey:  process.env.GEMINI_API_KEY,
            systemPrompt: `You are an invoice validation assistant. 
Extract and validate invoice data. Return structured JSON only.`
        });
        await _orchestrator.initialize();
    }
    return _orchestrator;
}

/**
 * @param {{ pdf_url: string, jurisdiction?: string }} parameters
 * @param {object} session       - A2A session
 * @param {string} senderSPIFFE - Calling agent SPIFFE ID
 * @param {object} a2aAdapter   - A2AProtocolAdapter instance (injected by plugin)
 */
module.exports = async function processInvoice(parameters, session, senderSPIFFE, a2aAdapter) {
    const { pdf_url, jurisdiction } = parameters;

    if (!pdf_url) throw new Error('Parameter "pdf_url" is required');

    // ── Step 1: Extract raw text from PDF ──────────────────────────────
    const extracted = await extractPDF(pdf_url);

    // ── Step 2: Parse invoice fields from text ─────────────────────────
    const fields = parseInvoiceFields(extracted.text);

    const invoiceRecord = {
        traceId:       session.traceId,
        source:        pdf_url,
        pages:         extracted.pages,
        extractMethod: extracted.method,
        fields,
        jurisdiction:  jurisdiction || 'auto-detect',
        processedAt:   new Date().toISOString(),
        requestedBy:   senderSPIFFE
    };

    // ── Step 3a: Delegate to Gemini planner via A2A (preferred) ────────
    if (a2aAdapter && a2aAdapter.isTrustedAgent(GEMINI_PLANNER_SPIFFE)) {
        try {
            const plan = await a2aAdapter.sendTask(GEMINI_PLANNER_SPIFFE, {
                capability: 'plan',
                parameters: {
                    goal: 'validate_and_categorize_invoice',
                    data: invoiceRecord
                },
                traceId: session.traceId
            });
            invoiceRecord.plan = plan;
            invoiceRecord.status  = 'planned';
            return invoiceRecord;
        } catch (err) {
            console.warn('[processInvoice] Gemini planner A2A failed, using local AI:', err.message);
        }
    }

    // ── Step 3b: Local Gemini fallback ─────────────────────────────────
    try {
        const orchestrator = await getOrchestrator();
        const prompt = buildValidationPrompt(fields, jurisdiction);
        const aiResult = await orchestrator.generate(prompt, { sessionId: session.id });

        // Try to parse JSON from AI response
        let parsedPlan = { summary: aiResult.text };
        const jsonMatch = aiResult.text.match(/\{[\s\S]+\}/);
        if (jsonMatch) {
            try { parsedPlan = JSON.parse(jsonMatch[0]); } catch { /* keep summary */ }
        }

        invoiceRecord.plan = parsedPlan;
        invoiceRecord.status = 'validated-local';
    } catch (err) {
        console.warn('[processInvoice] Local AI validation failed:', err.message);
        invoiceRecord.plan = null;
        invoiceRecord.status = 'extracted-only';
    }

    return invoiceRecord;
};

/* ── Helpers ─────────────────────────────────────────────────────────── */

function buildValidationPrompt(fields, jurisdiction) {
    return `Validate the following invoice fields and return a JSON object with keys:
  valid (boolean), issues (array of strings), taxJurisdiction (string), 
  suggestedCategory (string), totalAmount (number), currency (string).

Invoice fields:
- Number:     ${fields.invoiceNumber || 'NOT FOUND'}
- Date:       ${fields.date          || 'NOT FOUND'}
- Amount:     ${fields.amount        || 'NOT FOUND'}
- Vendor:     ${fields.vendor        || 'NOT FOUND'}
- Line items: ${fields.lineItems.length} items
- Jurisdiction hint: ${jurisdiction || 'not specified'}

Return only the JSON object, no markdown.`;
}
