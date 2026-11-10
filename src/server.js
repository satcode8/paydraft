const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');
const M = require('./model');
const S = require('./service');
const V = require('./views');
const mcp = require('./mcp');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const COOKIE = 'pd_session';
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 30 };

app.use(wrap(async (req, res, next) => {
  const t = req.cookies[COOKIE];
  req.user = t ? await db.sessions.user(t) : null;
  next();
}));
const needUser = (req, res, next) => (req.user ? next() : req.path.startsWith('/api') ? res.status(401).json({ error: 'Not logged in' }) : res.redirect('/login'));

// ---------- MCP ----------
mcp.mount(app);

// ---------- pages ----------
app.get('/healthz', (req, res) => res.send('ok'));
app.get('/', (req, res) => (req.user ? res.redirect('/app') : res.send(V.landing())));
app.get('/login', (req, res) => res.send(V.authPage('login')));
app.get('/signup', (req, res) => res.send(V.authPage('signup')));

app.post('/login', wrap(async (req, res) => {
  const u = await db.users.byEmail(req.body.email || '');
  if (!u || !(await bcrypt.compare(req.body.password || '', u.password_hash))) return res.status(401).send(V.authPage('login', 'Wrong email or password.', req.body));
  res.cookie(COOKIE, await db.sessions.create(u.id), cookieOpts).redirect('/app');
}));
app.post('/signup', wrap(async (req, res) => {
  const { name, email, password, business } = req.body;
  if (!email || !password || password.length < 6) return res.status(400).send(V.authPage('signup', 'Email and a 6+ character password are required.', req.body));
  if (await db.users.byEmail(email)) return res.status(400).send(V.authPage('signup', 'That email already has an account.', req.body));
  const u = await db.users.create(email, name || '', await bcrypt.hash(password, 10), { ...(business ? { name: business } : {}), email, default_currency: 'INR', default_tax_rate: 18, default_tax_label: 'GST' });
  res.cookie(COOKIE, await db.sessions.create(u.id), cookieOpts).redirect('/app/connect');
}));
app.post('/logout', wrap(async (req, res) => {
  if (req.cookies[COOKIE]) await db.sessions.destroy(req.cookies[COOKIE]);
  res.clearCookie(COOKIE).redirect('/');
}));

app.get('/app', needUser, (req, res) => res.send(V.dashboard(req.user)));
app.get('/app/doc/:id', needUser, (req, res) => res.send(V.editor(req.user, req.params.id)));
app.get('/app/new', needUser, wrap(async (req, res) => {
  const kind = req.query.kind === 'quote' ? 'quote' : 'invoice';
  const doc = await S.createDoc(req.user, kind, { client: { name: '' }, items: [{ description: '', quantity: 1, unit_price: 0 }] }, 'app');
  res.redirect(`/app/doc/${doc.id}`);
}));
app.get('/app/settings', needUser, (req, res) => res.send(V.settings(req.user, req.query.saved)));
app.post('/app/settings', needUser, wrap(async (req, res) => {
  const keys = ['name', 'email', 'phone', 'address', 'tax_id', 'payment_instructions', 'default_currency', 'default_tax_label', 'default_terms'];
  const b = { ...req.user.business };
  for (const k of keys) b[k] = String(req.body[k] || '').slice(0, 2000);
  b.default_currency = (b.default_currency || 'INR').toUpperCase().slice(0, 3);
  b.default_tax_rate = req.body.default_tax_rate === '' ? 18 : Number(req.body.default_tax_rate) || 0;
  b.default_tax_label = b.default_tax_label || 'GST';
  await db.users.setBusiness(req.user.id, b);
  res.redirect('/app/settings?saved=1');
}));
app.get('/app/connect', needUser, (req, res) => res.send(V.connect(req.user)));
app.post('/app/connect/rotate', needUser, wrap(async (req, res) => { await db.users.rotateToken(req.user.id); res.redirect('/app/connect'); }));

// ---------- JSON API for the editor ----------
const apiErr = (res, e) => (e instanceof S.UserError ? res.status(400).json({ error: e.message }) : (console.error(e), res.status(500).json({ error: 'Server error' })));

app.get('/api/documents', needUser, wrap(async (req, res) => {
  const [docs, feed, rec] = await Promise.all([db.documents.list(req.user.id), db.events.recentForUser(req.user.id), S.receivables(req.user)]);
  res.json({ documents: docs.map(M.present), feed, receivables: rec.totals_by_currency });
}));
app.get('/api/documents/:id', needUser, wrap(async (req, res) => {
  const doc = await db.documents.get(req.user.id, Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json({ doc: { ...M.present(doc), data: doc.data, public_id: doc.public_id }, events: await db.events.forDoc(doc.id), statuses: M.STATUSES[doc.kind], business: req.user.business });
}));
app.put('/api/documents/:id', needUser, wrap(async (req, res) => {
  try { const doc = await S.updateDoc(req.user, Number(req.params.id), req.body, 'app'); res.json({ doc: { ...M.present(doc), data: doc.data } }); }
  catch (e) { apiErr(res, e); }
}));
app.post('/api/documents/:id/status', needUser, wrap(async (req, res) => {
  try { const doc = await S.setStatus(req.user, Number(req.params.id), req.body.status, 'app'); res.json({ doc: M.present(doc) }); }
  catch (e) { apiErr(res, e); }
}));
app.post('/api/documents/:id/convert', needUser, wrap(async (req, res) => {
  try { const inv = await S.convertQuote(req.user, Number(req.params.id), 'app'); res.json({ doc: M.present(inv) }); }
  catch (e) { apiErr(res, e); }
}));
app.delete('/api/documents/:id', needUser, wrap(async (req, res) => { await db.documents.remove(req.user.id, Number(req.params.id)); res.json({ ok: true }); }));

// ---------- public client view ----------
app.get('/p/:pid', wrap(async (req, res) => {
  const doc = await db.documents.byPublicId(req.params.pid);
  if (!doc) return res.status(404).send('Not found');
  if (!(req.user && req.user.id === doc.user_id) && !(await db.events.recentView(doc.id))) await db.events.add(doc.id, 'client', 'viewed', 'Client opened the link');
  res.send(V.publicDoc(doc, { justResponded: req.query.r }));
}));
app.post('/p/:pid/respond', wrap(async (req, res) => {
  const doc = await db.documents.byPublicId(req.params.pid);
  if (!doc || doc.kind !== 'quote' || doc.status !== 'pending' || req.body.decision !== 'accept') return res.redirect(`/p/${req.params.pid}`);
  await db.documents.setStatus(doc.id, 'accepted');
  await db.events.add(doc.id, 'client', 'status', 'Client accepted the quote');
  res.redirect(`/p/${req.params.pid}?r=1`);
}));

app.use((err, req, res, next) => { console.error(err); res.status(500).send('Something went wrong'); });

// ---------- demo seed ----------
const SEED_VERSION = 2; // bump to reset the demo account's sample data on next boot
async function seed() {
  const business = {
    name: 'Studio Saffron', email: 'billing@studiosaffron.in', phone: '+91 98450 12345',
    address: '42 Residency Road\nBengaluru, KA 560025', tax_id: 'GSTIN 29ABCDE1234F1Z5',
    payment_instructions: 'Bank transfer: HDFC Bank · A/C 50100123456789 · IFSC HDFC0000123\nUPI: studiosaffron@hdfc',
    default_currency: 'INR', default_tax_rate: 18, default_tax_label: 'GST',
    default_terms: 'Payment due within 14 days of the invoice date. Thank you for your business!',
    seed_version: SEED_VERSION,
  };
  let u = await db.users.byEmail('demo@paydraft.app');
  if (u && (u.business || {}).seed_version === SEED_VERSION) return;
  if (u) { await db.pool.query('DELETE FROM documents WHERE user_id=$1', [u.id]); u = await db.users.setBusiness(u.id, business); }
  else u = await db.users.create('demo@paydraft.app', 'Demo Reviewer', await bcrypt.hash('demo1234', 10), business);
  const mk = async (kind, data, status) => { const d = await S.createDoc(u, kind, data, 'claude'); if (status) await S.setStatus(u, d.id, status, 'app'); return d; };
  await mk('invoice', { client: { name: 'Northwind Traders Pvt Ltd', email: 'accounts@northwind.example', address: '14 MG Road\nPune, MH 411001' }, title: 'September design retainer',
    issue_date: M.addDays(M.today(), -40), due_date: M.addDays(M.today(), -26),
    items: [{ description: 'Product design retainer (September)', quantity: 1, unit_price: 120000 }, { description: 'Additional prototype hours', quantity: 6, unit_price: 2000 }] });
  await mk('invoice', { client: { name: 'Lumen Health', email: 'finance@lumen.example' }, title: 'Onboarding flow audit',
    issue_date: M.addDays(M.today(), -20), items: [{ description: 'UX audit of onboarding (12 screens)', quantity: 1, unit_price: 75000 }, { description: 'Findings workshop (2 hours)', quantity: 2, unit_price: 5000 }] }, 'paid');
  await mk('quote', { client: { name: 'Kestrel Logistics', email: 'ops@kestrel.example' }, title: 'Driver app redesign – discovery',
    items: [{ description: 'Stakeholder interviews', quantity: 6, unit_price: 6000 }, { description: 'Journey map & opportunity report', quantity: 1, unit_price: 60000 }],
    notes: 'Happy to start the week after acceptance.', terms: '50% upfront, 50% on delivery. Valid for 30 days.' });
  console.log('Seeded demo account demo@paydraft.app / demo1234 (v' + SEED_VERSION + ')');
}

const port = process.env.PORT || 3000;
db.migrate().then(seed).then(() => app.listen(port, () => console.log(`Paydraft on ${M.baseUrl()}`))).catch((e) => { console.error(e); process.exit(1); });

module.exports = app;
