# Skill: nanopdf

**Version:** 1.0.0  
**Domain:** document

## Description

Lightweight PDF generation and manipulation — create PDFs from HTML templates or raw data, merge/split documents, fill form fields, compress, and sign. Used to generate voucher receipts, revenue reports, and operator summaries.

## When to Use

Invoke when the user asks about:
- Generating a PDF report or voucher receipt
- Merging multiple PDFs into one
- Splitting a PDF into pages
- Compressing a large PDF
- Filling a PDF form template with data

## Tools

| Action | Description |
|---|---|
| `create` | Generate PDF from HTML template or data |
| `merge` | Merge multiple PDF files |
| `split` | Split PDF into individual pages |
| `extract` | Extract text or images from PDF |
| `convert` | Convert document to PDF |
| `fill` | Fill PDF form fields with data |
| `sign` | Apply digital signature |
| `compress` | Compress PDF file size |

## Example: Generate Voucher Receipt

```json
{
  "action": "create",
  "template": "voucher-receipt",
  "data": {
    "code": "STAR-4A2F8C",
    "plan": "1Day",
    "price": "$5.00",
    "expiresAt": "2026-05-07T12:00:00Z"
  },
  "options": {
    "pageSize": "A4",
    "orientation": "portrait"
  }
}
```

## Permissions

- `document:create` — required for create/merge/fill/sign/compress
- `document:read` — required for extract/split
