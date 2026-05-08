# Skill: design

**Version:** 1.0.0  
**Domain:** creative

## Description

Hotspot portal and brand design generation for MikroTik captive portals. Generates login.html, status.html, logout.html, CSS, and JavaScript from brand inputs. Integrates with `hotspot_brand.js` for fleet deployment.

## When to Use

Invoke when the user asks about:
- Creating or redesigning a WiFi login portal
- Customizing colors, logos, and branding for a hotspot
- Generating HTML/CSS for a captive portal page
- Previewing portal designs

## Tools

| Action | Description |
|---|---|
| `generate` | Generate full portal bundle (login/status/logout HTML + CSS + JS) |
| `preview` | Return a preview URL or base64 screenshot |
| `customize` | Apply brand colors, logo, and copy to an existing template |
| `export` | Export portal bundle for `hotspot_brand` deployment |

## Example

```json
{
  "action": "generate",
  "brand": {
    "name": "Br3eze WiFi",
    "primaryColor": "#00C896",
    "logo_url": "https://example.com/logo.png",
    "tagline": "Fast. Affordable. Yours.",
    "language": "sw"
  }
}
```

## Output

Returns a bundle compatible with `hotspot_brand.run()`:

```json
{
  "login": "<html>...</html>",
  "status": "<html>...</html>",
  "logout": "<html>...</html>",
  "css": "body { ... }",
  "js": "document.ready(..."
}
```

## Notes

- Generated portals are mobile-first (320px min-width)
- Swahili, English, French, and Spanish portal copy supported
- Pass the output directly to `hotspot_brand` skill for fleet deployment
