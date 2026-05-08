import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

const db = new Database("agentos.db");

db.exec(`
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  reference TEXT UNIQUE,
  username TEXT,
  method TEXT, -- ecoCash | zipit | stripe | cash
  amount REAL,
  currency TEXT DEFAULT 'USD',
  plan TEXT,
  voucherCode TEXT,
  status TEXT DEFAULT 'paid', -- pending | paid | failed | refunded
  createdAt TEXT,
  metadata TEXT
);
`);
export function createReceipt({
    username,
    method,
    amount,
    currency = "USD",
    plan,
    voucherCode = null,
    metadata = {}
}) {
    const reference = generateReference();
    const now = new Date().toISOString();

    const stmt = db.prepare(`
    INSERT INTO receipts (
      id, reference, username, method, amount,
      currency, plan, voucherCode, status, createdAt, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

    stmt.run(
        uuidv4(),
        reference,
        username,
        method,
        amount,
        currency,
        plan,
        voucherCode,
        "paid",
        now,
        JSON.stringify(metadata)
    );

    return getReceipt(reference);
}
function generateReference() {
    const prefix = "STAR";
    const time = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();

    return `${prefix}-${time}-${rand}`;
}
export function getReceipt(reference) {
    const stmt = db.prepare("SELECT * FROM receipts WHERE reference = ?");
    return stmt.get(reference) || null;
}
export function getReceiptsByUser(username) {
    const stmt = db.prepare("SELECT * FROM receipts WHERE username = ? ORDER BY createdAt DESC");
    return stmt.all(username);
}
export function updateReceiptStatus(reference, status) {
    const stmt = db.prepare("UPDATE receipts SET status = ? WHERE reference = ?");
    stmt.run(status, reference);
    return getReceipt(reference);
}
export function getPendingReceipts() {
    const stmt = db.prepare("SELECT * FROM receipts WHERE status = 'pending'");
    return stmt.all();
}
export function listReceipts() {
    const stmt = db.prepare(`SELECT * FROM receipts ORDER BY createdAt DESC`);
    return stmt.all();
}
export function deleteReceipt(reference) {
    const stmt = db.prepare("DELETE FROM receipts WHERE reference = ?");
    stmt.run(reference);
    return { success: true };
}
export function getReceiptsByVoucher(voucherCode) {
    const stmt = db.prepare("SELECT * FROM receipts WHERE voucherCode = ? ORDER BY createdAt DESC");
    return stmt.all(voucherCode);
}
export function getReceiptsByDateRange(startDate, endDate) {
    const stmt = db.prepare("SELECT * FROM receipts WHERE createdAt BETWEEN ? AND ? ORDER BY createdAt DESC");
    return stmt.all(startDate, endDate);
}
export function getReceiptsByMethod(method) {
    const stmt = db.prepare("SELECT * FROM receipts WHERE method = ? ORDER BY createdAt DESC");
    return stmt.all(method);
}
export function getReceiptsByPlan(plan) {
    const stmt = db.prepare("SELECT * FROM receipts WHERE plan = ? ORDER BY createdAt DESC");
    return stmt.all(plan);
}
export function getReceiptsByStatus(status) {
    const stmt = db.prepare("SELECT * FROM receipts WHERE status = ? ORDER BY createdAt DESC");
    return stmt.all(status);
}
export function getReceiptsByAmountRange(minAmount, maxAmount) {
    const stmt = db.prepare("SELECT * FROM receipts WHERE amount BETWEEN ? AND ? ORDER BY createdAt DESC");
    return stmt.all(minAmount, maxAmount);
}
export function getReceiptsByCurrency(currency) {
    const stmt = db.prepare("SELECT * FROM receipts WHERE currency = ? ORDER BY createdAt DESC");
    return stmt.all(currency);
}
export function formatReceipt(reference) {
    const r = getReceipt(reference);

    if (!r) return "Receipt not found";

    return (
        `🧾 PAYMENT RECEIPT
━━━━━━━━━━━━━━━━━━━
Ref: ${r.reference}
User: ${r.username}
Plan: ${r.plan}
Method: ${r.method}
Amount: ${r.currency} ${r.amount}
Status: ${r.status}
Date: ${r.createdAt}
━━━━━━━━━━━━━━━━━━━
Thank you for using AgentOS`
    );
}
