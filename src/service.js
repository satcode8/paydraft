// Shared operations used by the web app AND the MCP server, so both paths behave identically.
const db = require('./db');
const M = require('./model');

class UserError extends Error {}

async function findDoc(user, ref) {
  if (ref == null || ref === '') throw new UserError('Provide a document id or number (e.g. INV-0003).');
  const s = String(ref).trim();
  const doc = /^\d+$/.test(s) ? await db.documents.get(user.id, Number(s)) : await db.documents.byNumber(user.id, s);
  if (!doc) throw new UserError(`No document found for "${s}". Use list_documents to see what exists.`);
  return doc;
}

async function createDoc(user, kind, input, source, extra = {}) {
  if (!['invoice', 'quote'].includes(kind)) throw new UserError('kind must be "invoice" or "quote"');
  const b = user.business || {};
  const defaults = {
    currency: b.default_currency || 'INR',
    tax_rate: b.default_tax_rate ?? 18,
    tax_label: b.default_tax_label || 'GST',
    terms: kind === 'invoice' ? (b.default_terms || '') : '',
  };
  const data = M.normalise(kind, { ...defaults, ...input });
  const doc = await db.documents.create(user.id, kind, data, source, { status: M.DEFAULT_STATUS[kind], ...extra });
  await db.events.add(doc.id, source, 'created', `${kind === 'quote' ? 'Quote' : 'Invoice'} ${doc.number} created`);
  return doc;
}

const LABEL = { items: 'line items', client: 'client details', issue_date: 'issue date', due_date: 'due date', tax_rate: 'GST %', tax_label: 'tax label' };

async function updateDoc(user, ref, patch, source) {
  const doc = await findDoc(user, ref);
  const before = M.normalise(doc.kind, {}, doc.data);
  const data = M.normalise(doc.kind, patch, doc.data);
  const changed = Object.keys(data).filter((k) => JSON.stringify(data[k]) !== JSON.stringify(before[k]));
  if (!changed.length) return doc;
  const t0 = M.totals(before).total, t1 = M.totals(data).total;
  const updated = await db.documents.update(user.id, doc.id, data);
  let detail = `Edited ${changed.map((k) => LABEL[k] || k.replace(/_/g, ' ')).join(', ')}`;
  if (t0 !== t1) detail += ` · total ${M.money(t0, before.currency)} → ${M.money(t1, data.currency)}`;
  await db.events.add(doc.id, source, 'edited', detail);
  return updated;
}

async function setStatus(user, ref, status, source) {
  const doc = await findDoc(user, ref);
  const next = M.canonicalStatus(doc.kind, status);
  if (!next) throw new UserError(`A ${doc.kind} can be: ${M.STATUSES[doc.kind].join(' or ')}.`);
  if (next === doc.status) return doc;
  let updated = await db.documents.setStatus(doc.id, next);
  if (doc.kind === 'invoice') {
    const data = { ...doc.data };
    if (next === 'paid') { data.paid_at = M.today(); data.paid_amount = M.totals(doc.data).total; }
    else { data.paid_at = null; data.paid_amount = null; }
    updated = await db.documents.update(user.id, doc.id, data);
  }
  await db.events.add(doc.id, source, 'status', `Marked ${next}`);
  return updated;
}

async function convertQuote(user, ref, source) {
  const quote = await findDoc(user, ref);
  if (quote.kind !== 'quote') throw new UserError(`${quote.number} is not a quote.`);
  if (quote.data.invoice_number) throw new UserError(`${quote.number} was already turned into ${quote.data.invoice_number}.`);
  const data = { ...quote.data, invoice_number: null, issue_date: M.today(), due_date: M.addDays(M.today(), 14),
    terms: quote.data.terms || (user.business || {}).default_terms || '' };
  const inv = await db.documents.create(user.id, 'invoice', M.normalise('invoice', data), source, { status: 'unpaid', source_quote_id: quote.id });
  await db.documents.setStatus(quote.id, 'accepted');
  await db.documents.update(user.id, quote.id, { ...quote.data, invoice_number: inv.number });
  await db.events.add(quote.id, source, 'converted', `Turned into invoice ${inv.number}`);
  await db.events.add(inv.id, source, 'created', `Invoice ${inv.number} created from quote ${quote.number}`);
  return inv;
}

async function receivables(user) {
  const docs = (await db.documents.list(user.id)).filter((d) => d.kind === 'invoice');
  const byCur = {};
  const bucket = (c) => (byCur[c] ||= { to_collect: 0, overdue: 0, paid_last_30_days: 0 });
  const overdue = [];
  const since = M.addDays(M.today(), -30);
  for (const d of docs) {
    const t = M.totals(d.data).total; const b = bucket(d.data.currency); const st = M.effectiveStatus(d);
    if (st === 'unpaid' || st === 'overdue') b.to_collect += t;
    if (st === 'overdue') { b.overdue += t; overdue.push(M.present(d)); }
    if (st === 'paid' && (d.data.paid_at || '') >= since) b.paid_last_30_days += t;
  }
  for (const c in byCur) for (const k in byCur[c]) byCur[c][k] = Math.round(byCur[c][k] * 100) / 100;
  overdue.sort((a, b) => b.days_overdue - a.days_overdue);
  return { totals_by_currency: byCur, overdue_invoices: overdue, invoice_count: docs.length };
}

module.exports = { UserError, findDoc, createDoc, updateDoc, setStatus, convertQuote, receivables };
