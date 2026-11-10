// Pure business logic: normalising document data, totals, statuses. No AI anywhere.

// Kept deliberately small: an invoice is unpaid or paid (overdue is derived), a quote is pending or accepted.
const STATUSES = {
  invoice: ['unpaid', 'paid'],
  quote: ['pending', 'accepted'],
};
const DEFAULT_STATUS = { invoice: 'unpaid', quote: 'pending' };
// Map older / synonym values onto the simple set.
const LEGACY = { draft: null, sent: null, void: 'unpaid', declined: 'pending', expired: 'pending', converted: 'accepted', open: null };
function canonicalStatus(kind, s) {
  s = String(s || '').toLowerCase();
  if (STATUSES[kind].includes(s)) return s;
  if (s in LEGACY) return LEGACY[s] || DEFAULT_STATUS[kind];
  if (kind === 'quote' && s === 'paid') return 'accepted';
  return null;
}

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const str = (v, max = 2000) => (v == null ? '' : String(v)).slice(0, max);
const round2 = (n) => Math.round(n * 100) / 100;

function normaliseItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 200).map((it) => ({
    description: str(it.description, 500),
    quantity: num(it.quantity, 1),
    unit_price: round2(num(it.unit_price, 0)),
  })).filter((it) => it.description || it.unit_price);
}

// Merge a partial patch into existing data and return clean data.
function normalise(kind, patch = {}, base = {}) {
  const merged = { ...base, ...patch };
  const client = { ...(base.client || {}), ...(patch.client || {}) };
  const issue = /^\d{4}-\d{2}-\d{2}$/.test(merged.issue_date) ? merged.issue_date : today();
  const defaultDue = addDays(issue, kind === 'quote' ? 30 : 14);
  return {
    title: str(merged.title, 200),
    client: {
      name: str(client.name, 200),
      email: str(client.email, 200),
      address: str(client.address, 1000),
      tax_id: str(client.tax_id, 100),
    },
    currency: (str(merged.currency || 'INR', 3) || 'INR').toUpperCase(),
    issue_date: issue,
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(merged.due_date) ? merged.due_date : defaultDue,
    items: normaliseItems(merged.items),
    discount: Math.max(0, round2(num(merged.discount, 0))),
    tax_rate: Math.min(100, Math.max(0, num(merged.tax_rate, 0))),
    tax_label: str(merged.tax_label || 'GST', 40),
    invoice_number: merged.invoice_number ? str(merged.invoice_number, 20) : null,
    notes: str(merged.notes, 4000),
    terms: str(merged.terms, 4000),
    paid_at: merged.paid_at || null,
    paid_amount: merged.paid_amount != null ? round2(num(merged.paid_amount)) : null,
  };
}

function totals(data) {
  const subtotal = round2((data.items || []).reduce((s, it) => s + num(it.quantity) * num(it.unit_price), 0));
  const discount = Math.min(subtotal, num(data.discount));
  const taxable = round2(subtotal - discount);
  const tax = round2(taxable * num(data.tax_rate) / 100);
  return { subtotal, discount, tax, total: round2(taxable + tax) };
}

// Overdue / expired are derived, not stored.
function effectiveStatus(doc) {
  const d = doc.data || {};
  if (doc.kind === 'invoice' && doc.status === 'unpaid' && d.due_date && d.due_date < today()) return 'overdue';
  return doc.status;
}

function daysOverdue(doc) {
  if (effectiveStatus(doc) !== 'overdue') return 0;
  return Math.round((Date.parse(today()) - Date.parse(doc.data.due_date)) / 86400000);
}

function money(amount, currency = 'INR') {
  try { return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency }).format(amount); }
  catch { return `${currency} ${Number(amount).toFixed(2)}`; }
}

function baseUrl() {
  return (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

// Compact representation returned to Claude and to the web API.
function present(doc) {
  const t = totals(doc.data);
  return {
    id: doc.id,
    number: doc.number,
    kind: doc.kind,
    status: effectiveStatus(doc),
    stored_status: doc.status,
    client: doc.data.client,
    title: doc.data.title,
    currency: doc.data.currency,
    issue_date: doc.data.issue_date,
    due_date: doc.data.due_date,
    ...t,
    total_formatted: money(t.total, doc.data.currency),
    days_overdue: daysOverdue(doc),
    created_via: doc.created_via,
    invoice_number: doc.data.invoice_number || null,
    edit_url: `${baseUrl()}/app/doc/${doc.id}`,
    public_url: `${baseUrl()}/p/${doc.public_id}`,
    updated_at: doc.updated_at,
  };
}

module.exports = { STATUSES, DEFAULT_STATUS, canonicalStatus, normalise, totals, effectiveStatus, daysOverdue, money, present, baseUrl, today, addDays };
