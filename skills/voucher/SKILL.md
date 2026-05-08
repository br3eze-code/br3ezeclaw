# Skill: voucher

**Version:** 2026.7.0  
**Dispatcher:** `manage_vouchers`  
**Domain:** billing

## Description

Voucher lifecycle management for AgentOS community WiFi operators. Generates `STAR-XXXXXX` codes, provisions users on MikroTik RouterOS, creates QR codes, and runs the Auto-Renewal (recurring billing) engine that extends sessions when a user's wallet has sufficient balance.

## When to Use

Invoke when the user asks about:
- Creating a new WiFi voucher for a plan (1hour / 1Day / 7Day / 30Day)
- Redeeming a voucher code for a user
- Listing vouchers (active, used, recent)
- Revenue and usage statistics
- Revoking a voucher
- Auto-renewing an expiring subscription

## Plans

| Plan | Duration | Price (USD) |
|---|---|---|
| `1hour` | 1 hour | $1.00 |
| `1Day` | 24 hours | $5.00 |
| `7Day` | 7 days | $25.00 |
| `30Day` | 30 days | $80.00 |

**Code format:** `STAR-[A-F0-9]{6}` — generated via `crypto.randomBytes(3)`

## Tools

| Action | Description |
|---|---|
| `voucher.create` | Generate code, save to DB, provision on MikroTik, return QR URL |
| `voucher.redeem` | Mark voucher as used for a specific user |
| `voucher.list` | List vouchers (optional `used` filter, `limit`) |
| `voucher.stats` | Count, revenue, and breakdown by plan |
| `voucher.revoke` | Mark used + remove MikroTik hotspot user |
| `voucher.renew` | Auto-renew: deduct wallet, extend MikroTik session |

## Lifecycle

```
createVoucher() → saved to DB → provisioned on MikroTik → QR URL returned →
customer redeems → session expires →
Auto-Renewal Engine (checks wallet balance) → renews or kicks →
expireOldVouchers() marks used
```

## Example: Create Voucher

```json
{
  "action": "voucher.create",
  "plan": "1Day",
  "actor": "telegram:123456789"
}
```

## Example: Redeem

```json
{
  "action": "voucher.redeem",
  "code": "STAR-4A2F8C",
  "user": "alice"
}
```

## Recurring Billing (Auto-Renewal)

The `guardHotspot` reaper in `AgentOSOrchestrator` runs every 1 hour.  
If a user has `hasPlan` status and wallet balance ≥ plan price:
1. Wallet is debited
2. MikroTik session is extended — no service interruption

If wallet is insufficient, the session expires and the user is notified.
