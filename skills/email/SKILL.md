# Skill: email

**Version:** 1.0.0  
**Domain:** communication

## Description

Send and manage emails across multiple provider backends — SMTP, SendGrid, AWS SES, and Gmail API. Used by AgentOS for operator digests, voucher notifications, and system alerts.

## When to Use

Invoke when the user asks about:
- Sending a notification or report by email
- Emailing a voucher code or QR code to a customer
- Reading or searching received emails
- Deleting email messages

## Tools

| Action | Description |
|---|---|
| `send` | Send an email with optional attachments |
| `read` | Read/fetch emails from inbox |
| `search` | Search emails by query |
| `delete` | Delete an email message |

## Providers

| Provider | Description |
|---|---|
| `smtp` (default) | Standard SMTP server |
| `sendgrid` | SendGrid transactional API |
| `aws-ses` | Amazon Simple Email Service |
| `gmail-api` | Gmail REST API (OAuth2) |

## Example: Send Email

```json
{
  "action": "send",
  "provider": "smtp",
  "to": "operator@example.com",
  "subject": "Daily Revenue Report",
  "body": "Today's revenue: $45.00 across 9 vouchers.",
  "attachments": []
}
```

## Permissions

- `email:send` — required to send emails
- `email:read` — required to read/search/delete emails
