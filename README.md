# Paydraft

**Tell Claude what you did. Get paid for it.**

Paydraft is a billing desk for your own Claude. You describe the work in plain words in Claude, and Claude writes the invoice or quote. Paydraft stores it, lets you edit every line, gives your client a live link (with Accept for quotes and a PDF download), and tracks who still owes you.

**There is no AI inside Paydraft.** No model calls and no API keys. Claude does the thinking and writing through MCP. Paydraft does the saving, editing, maths and publishing.

## Try it

- Live app: `https://<your-render-url>`
- Reviewer login: `demo@paydraft.app` / `demo1234`. You can also sign up for your own account.
- MCP URL: log in → **Connect Claude**, then copy the private URL (`https://<host>/mcp/<token>`).

### Connect to Claude (about 30 seconds)
1. In claude.ai, go to **Settings → Connectors → Add custom connector**.
2. Name it **Paydraft** and paste your MCP URL. No OAuth is needed. Click **Add**.
3. In a chat, turn on Paydraft in the tools menu and ask:
   *"Invoice Acme Robotics for 32 hours of product design at ₹2,500/hr plus ₹6,000 for a testing tool, due in 15 days."*
4. Open the `edit_url` Claude returns. The invoice is there, and you can edit it. Changes made in either place show up live in the other.

## MCP tools
| Tool | What it does |
|---|---|
| `create_invoice` / `create_quote` | Store a document Claude wrote. Returns totals, an edit link and a client link |
| `update_document` | Patch any field, or replace the line items |
| `set_status` | Invoices: unpaid / paid. Quotes: pending / accepted |
| `convert_quote_to_invoice` | Turn an accepted quote into an invoice |
| `list_documents`, `get_document` | Read back documents, including the activity history of edits made by hand in the app |
| `get_receivables` | Outstanding, overdue and paid totals, plus the overdue list, so Claude can write reminders |
| `get_business_profile`, `update_business_profile` | Sender details and defaults printed on every document |

## Stack
Node 20+ · Express · Postgres · MCP TypeScript SDK (stateless Streamable HTTP). Plain server-rendered HTML and vanilla JS, with no build step.

## Deploy (Render, one click)
Push this repo to GitHub → in Render, **New → Blueprint** → pick the repo. `render.yaml` creates a free Postgres database and the web service, and `RENDER_EXTERNAL_URL` is used automatically for links. The demo account is created on first boot.

Other hosts: set `DATABASE_URL` (Postgres) and `PUBLIC_URL`, then run `npm start`.
