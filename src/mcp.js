// MCP server: exposes Paydraft to the customer's own Claude. Claude does the thinking and
// writing; these tools only store, edit, compute and publish. There is no model call here.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const db = require('./db');
const M = require('./model');
const S = require('./service');

const SOURCE = 'claude';

const item = z.object({
  description: z.string().describe('What was delivered, e.g. "Brand strategy workshop (2 days)"'),
  quantity: z.number().default(1).describe('Hours, units, days…'),
  unit_price: z.number().describe('Price per unit, in the document currency'),
});
const client = z.object({
  name: z.string().describe('Client company or person'),
  email: z.string().optional(),
  address: z.string().optional().describe('Multi-line postal address'),
  tax_id: z.string().optional().describe('Client VAT / GSTIN / tax number if known'),
});
const docFields = {
  client: client,
  items: z.array(item).min(1).describe('Line items. Claude should break the work into clear, billable lines.'),
  title: z.string().optional().describe('Short project title shown on the document, e.g. "Website redesign – Phase 1"'),
  currency: z.string().length(3).optional().describe('ISO code. Defaults to INR (₹). Only set it for foreign clients, e.g. USD.'),
  issue_date: z.string().optional().describe('YYYY-MM-DD, defaults to today'),
  due_date: z.string().optional().describe('YYYY-MM-DD. Invoices default to +14 days, quotes are valid for +30 days'),
  discount: z.number().optional().describe('Flat discount amount (not percent)'),
  tax_rate: z.number().optional().describe('GST percent. Defaults to 18. Use 0 for exports under LUT or unregistered sellers.'),
  tax_label: z.string().optional().describe('Defaults to "GST"'),
  notes: z.string().optional().describe('Friendly note to the client shown on the document'),
  terms: z.string().optional().describe('Payment terms / scope assumptions'),
};
const ref = z.union([z.string(), z.number()]).describe('Document number like "INV-0003" or its numeric id');

const ok = (obj, hint) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) + (hint ? `\n\n${hint}` : '') }] });
const fail = (msg) => ({ isError: true, content: [{ type: 'text', text: msg }] });
const guard = (fn) => async (args) => {
  try { return await fn(args); }
  catch (e) { if (e instanceof S.UserError) return fail(e.message); console.error(e); return fail('Paydraft hit an unexpected error: ' + e.message); }
};

function buildServer(user) {
  const server = new McpServer(
    { name: 'paydraft', version: '1.0.0' },
    { instructions:
      'Paydraft stores, edits and publishes invoices and quotes for this user. Amounts are in Indian rupees (INR) with 18% GST by default. You (Claude) write the content: ' +
      'turn the user\'s description of work into clean line items, notes and terms, then call create_invoice or create_quote. ' +
      'Always give the user both links you get back: edit_url (their editor) and public_url (what their client sees). ' +
      'Use get_receivables to answer "who owes me money" and to draft payment reminder emails yourself. ' +
      'If the business profile is empty, ask the user for their business name and payment details and save them with update_business_profile.' });

  const fresh = async () => (await db.users.byId(user.id));

  server.registerTool('get_business_profile', {
    title: 'Get business profile',
    description: 'The sender details printed on every invoice/quote (business name, address, tax id, payment instructions) and defaults.',
    inputSchema: {}, annotations: { readOnlyHint: true },
  }, guard(async () => ok((await fresh()).business)));

  server.registerTool('update_business_profile', {
    title: 'Update business profile',
    description: 'Save the user\'s business details. Only the fields you pass are changed.',
    inputSchema: {
      name: z.string().optional(), email: z.string().optional(), phone: z.string().optional(),
      address: z.string().optional(), tax_id: z.string().optional(),
      payment_instructions: z.string().optional().describe('Bank / UPI / PayPal details printed on invoices'),
      default_currency: z.string().length(3).optional(), default_tax_rate: z.number().optional(),
      default_tax_label: z.string().optional(), default_terms: z.string().optional(),
    },
  }, guard(async (args) => {
    const u = await fresh();
    const clean = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
    if (clean.default_currency) clean.default_currency = clean.default_currency.toUpperCase();
    const saved = await db.users.setBusiness(u.id, { ...u.business, ...clean });
    return ok(saved.business, 'Saved. These details now appear on every document.');
  }));

  for (const kind of ['invoice', 'quote']) {
    server.registerTool(`create_${kind}`, {
      title: `Create ${kind}`,
      description: kind === 'invoice'
        ? 'Create a new invoice (status: unpaid). Amounts are in rupees (INR) with 18% GST unless told otherwise. Returns the invoice number, totals, an edit link for the user and a client link.'
        : 'Create a new quote (status: pending) the client can accept online. Amounts in rupees (INR) with 18% GST unless told otherwise. Returns totals, edit link and client link.',
      inputSchema: docFields,
    }, guard(async (args) => {
      const doc = await S.createDoc(await fresh(), kind, args, SOURCE);
      return ok(M.present(doc), `Created ${doc.number}. It is live in Paydraft now. Share public_url with the client; the user can tweak it at edit_url.`);
    }));
  }

  server.registerTool('list_documents', {
    title: 'List invoices and quotes',
    description: 'List the user\'s invoices and quotes with status and totals. Invoice status: unpaid, overdue (unpaid and past due) or paid. Quote status: pending or accepted.',
    inputSchema: {
      kind: z.enum(['invoice', 'quote']).optional(),
      status: z.string().optional(),
      client: z.string().optional().describe('Case-insensitive match on client name'),
      limit: z.number().int().min(1).max(100).optional(),
    }, annotations: { readOnlyHint: true },
  }, guard(async ({ kind, status, client, limit }) => {
    let docs = (await db.documents.list(user.id)).map(M.present);
    if (kind) docs = docs.filter((d) => d.kind === kind);
    if (status) docs = docs.filter((d) => d.status === status.toLowerCase());
    if (client) docs = docs.filter((d) => (d.client.name || '').toLowerCase().includes(client.toLowerCase()));
    return ok({ count: docs.length, documents: docs.slice(0, limit || 50) });
  }));

  server.registerTool('get_document', {
    title: 'Get document', description: 'Full details of one invoice or quote, including every line item and its activity history (who changed what, including edits made by hand in the app and client views).',
    inputSchema: { document: ref }, annotations: { readOnlyHint: true },
  }, guard(async ({ document }) => {
    const doc = await S.findDoc(user, document);
    const activity = (await db.events.forDoc(doc.id)).map((e) => ({ at: e.at, by: e.source, action: e.action, detail: e.detail }));
    return ok({ ...M.present(doc), items: doc.data.items, notes: doc.data.notes, terms: doc.data.terms,
      discount: doc.data.discount, tax_rate: doc.data.tax_rate, tax_label: doc.data.tax_label, activity });
  }));

  server.registerTool('update_document', {
    title: 'Update document',
    description: 'Change an existing invoice or quote. Only fields you pass change. Passing items REPLACES all line items, so send the full list.',
    inputSchema: { document: ref, ...Object.fromEntries(Object.entries(docFields).map(([k, v]) => [k, k === 'client' ? client.partial().optional() : v.optional()])) },
  }, guard(async ({ document, ...patch }) => {
    const doc = await S.updateDoc(await fresh(), document, patch, SOURCE);
    return ok(M.present(doc), 'Updated. The change is already live on the public link.');
  }));

  server.registerTool('set_status', {
    title: 'Set status',
    description: 'Mark an invoice as paid or unpaid, or a quote as accepted or pending.',
    inputSchema: { document: ref, status: z.enum(['unpaid', 'paid', 'pending', 'accepted']) },
  }, guard(async ({ document, status }) => ok(M.present(await S.setStatus(await fresh(), document, status, SOURCE)))));

  server.registerTool('convert_quote_to_invoice', {
    title: 'Convert quote to invoice',
    description: 'Turn an accepted quote into a new draft invoice with the same line items.',
    inputSchema: { quote: ref },
  }, guard(async ({ quote }) => {
    const inv = await S.convertQuote(await fresh(), quote, SOURCE);
    return ok(M.present(inv), `Created ${inv.number} from the quote.`);
  }));

  server.registerTool('get_receivables', {
    title: 'Who owes me money',
    description: 'Money still to collect, overdue and recently paid totals per currency, plus every overdue invoice with client email and days overdue. Use it to prioritise follow-ups and draft reminder emails.',
    inputSchema: {}, annotations: { readOnlyHint: true },
  }, guard(async () => ok(await S.receivables(await fresh()))));

  return server;
}

// Stateless Streamable HTTP: one server + transport per request, user resolved from the secret URL token.
function mount(app) {
  const handler = async (req, res) => {
    const user = await db.users.byMcpToken(req.params.token);
    if (!user) return res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unknown Paydraft connector URL. Copy it again from Paydraft → Connect Claude.' }, id: null });
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
    const server = buildServer(user);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('MCP error', e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  };
  app.all('/mcp/:token', handler);
}

module.exports = { mount, buildServer };
