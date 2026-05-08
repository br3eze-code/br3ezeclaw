# Skill: finance

**Version:** 2026.7.0  
**Dispatcher:** `manage_finance`  
**Domain:** finance

## Description

Financial engine for AgentOS operators — revenue reports, 7-day trend data, audit trail, enhanced P2P credit transfers (with phone/email/username resolution and fee support), and Mastercard Account-to-Account (A2A) payment initiation and status tracking.

## When to Use

Invoke when the user asks about:

- Revenue summary or income reports
- 7-day voucher sales trends
- Audit logs or transaction history
- Sending credits to another user (P2P transfer)
- Looking up a user by phone, email, or username
- Initiating a Mastercard A2A payment for a voucher
- Checking the status of a Mastercard payment

## Tools

| Action | Description |
|---|---|
| `finance.report` | All-time revenue summary grouped by plan |
| `finance.trends` | 7-day daily revenue trend |
| `finance.audit` | Last N audit events |
| `p2p.transfer` | Transfer credits between users with fee deduction |
| `p2p.resolve` | Resolve phone/email/username → Firebase UID |
| `mastercard.initiate` | Initiate A2A bank-to-wallet payment |
| `mastercard.status` | Check status of an initiated payment |

## Parameters

**P2P Transfer:**

```json
{
  "action": "p2p.transfer",
  "from": "uid_sender",
  "to": "+254712345678",
  "amount": 5.00
}
```

**Mastercard Initiate:**

```json
{
  "action": "mastercard.initiate",
  "voucherCode": "STAR-4A2F-QWTQ",
  "amount": 5.00,
  "currency": "USD"
}
```

## P2P Identity Resolvers

Recipient can be specified as:

- **Phone (E.164):** `+254712345678`
- **Email:** `alice@example.com`
- **Username:** `alice`

## Fee Logic

Configured via environment variables:

- `P2P_FEE_PERCENT` — percentage fee (default: `0`)
- `P2P_FEE_FLAT` — flat fee in USD (default: `0`)

Dual-entry bookkeeping: `p2p_transfer_sent` and `p2p_transfer_received` records written separately.

## Mastercard A2A

- OAuth 1.0a RSA-SHA256 signing
- Webhook reconciliation: `POST /api/webhook/mastercard`
- Status check: `GET /api/voucher/payment/status/:paymentId`
