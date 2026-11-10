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

async function createDoc(user, kind, input, source) {
  if (!['invoice', 'quote'].includes(kind)) throw new UserError('kind must be "invoice" or "quote"');
  const defaults = {
    currency: user.business.default_currency || 'USD',
    tax_rate: user.business.default_tax_rate ?? 0,
    tax_label: user.business.default_tax_label || 'Tax',
    terms: kind === 'invoice' ? (user.business.default_terms || '') : '',
  };
  const data = M.normalise(kind, { ...defaults, ...input });
  const doc = await db.documents.create(user.id, kind, data, source);
  await db.events.add(doc.id, source, 'created', `${kind} ${doc.number} created`);
  return doc;
}

async function updateDoc(user, ref, patch, source) {
  const doc = await findDoc(user, ref);
  if (doc.status === 'void') throw new UserError(`${doc.number} is void and can't be edited.`);
  const data = M.normalise(doc.kind, patch, doc.data);
  const before = M.totals(doc.data).total, after = M.totals(data).total;
  const updated = await db.documents.update(user.id, doc.id, data);
  const LABEL = { items: 'line items', client: 'client details', issue_date: 'issue date', due_date: 'due date', tax_rate: 'tax rate', tax_label: 'tax label' };
  const changed = Object.keys(data).filter((k) => JSON.stringify(data[k]) !== JSON.stringify(M.normalise(doc.kind, {}, doc.data)[k]));
  if (!changed.length) return doc;
  let detail = `Edited ${changed.map((k) => LABEL[k] || k).join(', ')}`;
  if (before !== after) detail += ` · total ${M.money(before, doc.data.currency)} → ${M.money(after, data.currency)}`;
  await db.events.add(doc.id, source, 'edited', detail);
  return updated;
}

async function setStatus(user, ref, status, source) {
  const doc = await findDoc(user, ref);
  const allowed = M.STATUSES[doc.kind];
  if (!allowed.includes(status)) throw new UserError(`Status for a ${doc.kind} must be one of: ${allowed.join(', ')}`);
  if (status === 'converted') throw new UserError('Use convert_quote_to_invoice to convert a quote.');
  let updated = await db.documents.setStatus(doc.id, status);
  if (doc.kind === 'invoice') {
    const data = { ...doc.data };
    if (status === 'paid') { data.paid_at = M.today(); data.paid_amount = M.totals(doc.data).total; }
    else { data.paid_at = null; data.paid_amount = null; }
    updated = await db.documents.update(user.id, doc.id, data);
  }
  await db.events.add(doc.id, source, 'status', `${doc.status} → ${status}`);
  return updated;
}

async function convertQuote(user, ref, source) {
  const quote = await findDoc(user, ref);
  if (quote.kind !== 'quote') throw new UserError(`${quote.number} is not a quote.`);
  if (quote.status === 'converted') throw new UserError(`${quote.number} was already converted.`);
  const data = { ...quote.data, issue_date: M.today(), due_date: M.addDays(M.today(), 14),
    terms: quote.data.terms || user.business.default_terms || '' };
  const inv = await db.documents.create(user.id, 'invoice', M.normalise('invoice', data), source, { source_quote_id: quote.id });
  await db.documents.setStatus(quote.id, 'converted');
  await db.events.add(quote.id, source, 'converted', `Converted to ${inv.number}`);
  await db.events.add(inv.id, source, 'created', `Created from quote ${quote.number}`);
  return inv;
}

async function receivables(user) {
  const docs = (await db.documents.list(user.id)).filter((d) => d.kind === 'invoice');
  const byCur = {};
  const bucket = (c) => (byCur[c] ||= { outstanding: 0, overdue: 0, paid_last_30_days: 0, draft: 0 });
  const overdue = [];
  const since = M.addDays(M.today(), -30);
  for (const d of docs) {
    const t = M.totals(d.data).total; const b = bucket(d.data.currency); const st = M.effectiveStatus(d);
    if (st === 'sent' || st === 'overdue') b.outstanding += t;
    if (st === 'overdue') { b.overdue += t; overdue.push(M.present(d)); }
    if (st === 'paid' && (d.data.paid_at || '') >= since) b.paid_last_30_days += t;
    if (st === 'draft') b.draft += t;
  }
  for (const c in byCur) for (const k in byCur[c]) byCur[c][k] = Math.round(byCur[c][k] * 100) / 100;
  overdue.sort((a, b) => b.days_overdue - a.days_overdue);
  return { totals_by_currency: byCur, overdue_invoices: overdue, invoice_count: docs.length };
}

module.exports = { UserError, findDoc, createDoc, updateDoc, setStatus, convertQuote, receivables };
