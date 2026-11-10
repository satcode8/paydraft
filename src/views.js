const M = require('./model');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl2br = (s) => esc(s).replace(/\n/g, '<br>');

const head = (title) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Paydraft</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%231f5c45'/><text x='16' y='22' font-size='17' text-anchor='middle' fill='white' font-family='Georgia'>P</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/app.css"></head>`;

function shell(user, title, active, body, scripts = '') {
  const nav = (href, label, key) => `<a href="${href}" class="${active === key ? 'on' : ''}">${label}</a>`;
  return `${head(title)}<body class="app">
<header class="topbar">
  <a class="brand" href="/app"><span class="mark">P</span>Paydraft</a>
  <nav>${nav('/app', 'Documents', 'docs')}${nav('/app/settings', 'Business profile', 'settings')}${nav('/app/connect', 'Connect Claude', 'connect')}</nav>
  <div class="who"><span>${esc(user.email)}</span><form method="post" action="/logout"><button class="link">Log out</button></form></div>
</header>
<main class="wrap">${body}</main>${scripts}</body></html>`;
}

function landing() {
  return `${head('Invoices that Claude writes')}<body class="landing">
<div class="hero wrap">
  <div class="brand big"><span class="mark">P</span>Paydraft</div>
  <h1>Tell Claude what you did.<br><em>Get paid for it.</em></h1>
  <p class="lede">Paydraft is the billing desk for your own Claude. Describe the work in plain words, and Claude writes the invoice or quote. Paydraft stores it, lets you edit every line, sends your client a live link, and tracks who still owes you.</p>
  <div class="cta"><a class="btn primary" href="/signup">Create free account</a><a class="btn" href="/login">Log in</a></div>
  <div class="demo-cred">Reviewer login: <code>demo@paydraft.app</code> / <code>demo1234</code></div>
  <div class="chat-sample">
    <div class="bubble you">Invoice Acme Robotics for the March retainer: 32 hours of product design at $95/hr, and the $240 usability-testing tool. 18% GST, due in 15 days.</div>
    <div class="bubble claude"><b>Created INV-0007 · $3,869.92</b><br>3 line items, GST 18%, due 25 Mar.<br><span class="lnk">Edit in Paydraft ↗</span> · <span class="lnk">Client link ↗</span></div>
  </div>
  <ol class="how">
    <li><b>Connect.</b> Paste your private Paydraft link into Claude → Settings → Connectors.</li>
    <li><b>Ask.</b> "Quote Northwind for a 3-page brand refresh." Claude writes the scope and prices.</li>
    <li><b>Own it.</b> Edit in Paydraft, send the live link, mark it paid. Claude can see it all too.</li>
  </ol>
  <p class="fine">No AI runs inside Paydraft and there are no model keys. Your Claude does the thinking and Paydraft does the bookkeeping.</p>
</div></body></html>`;
}

function authPage(mode, error = '', values = {}) {
  const signup = mode === 'signup';
  return `${head(signup ? 'Sign up' : 'Log in')}<body class="landing"><div class="auth">
<a class="brand big" href="/"><span class="mark">P</span>Paydraft</a>
<form method="post" class="card">
  <h2>${signup ? 'Create your account' : 'Welcome back'}</h2>
  ${error ? `<div class="err">${esc(error)}</div>` : ''}
  ${signup ? `<label>Your name<input name="name" required value="${esc(values.name)}"></label>
  <label>Business name<input name="business" placeholder="e.g. Studio Saffron" value="${esc(values.business)}"></label>` : ''}
  <label>Email<input name="email" type="email" required value="${esc(values.email || (signup ? '' : 'demo@paydraft.app'))}"></label>
  <label>Password<input name="password" type="password" required minlength="6" ${signup ? '' : 'value="demo1234"'}></label>
  <button class="btn primary full">${signup ? 'Create account' : 'Log in'}</button>
  <p class="muted small">${signup ? 'Already have one? <a href="/login">Log in</a>' : 'New here? <a href="/signup">Create an account</a>'}</p>
</form></div></body></html>`;
}

function dashboard(user) {
  return shell(user, 'Documents', 'docs', `
<section class="page-head">
  <div><h1>Documents</h1><p class="muted">Everything Claude or you created. This page updates live.</p></div>
  <div class="actions"><a class="btn" href="/app/new?kind=quote">New quote</a><a class="btn primary" href="/app/new?kind=invoice">New invoice</a></div>
</section>
<section class="stats" id="stats"></section>
<section class="grid2">
  <div class="card flush"><div class="filters" id="filters">
    <button data-f="all" class="on">All</button><button data-f="invoice">Invoices</button><button data-f="quote">Quotes</button>
    <button data-f="overdue">Overdue</button><button data-f="claude">✶ By Claude</button></div>
    <table class="docs"><thead><tr><th>Number</th><th>Client</th><th>Status</th><th>Due</th><th class="r">Total</th></tr></thead><tbody id="rows"><tr><td colspan="5" class="muted">Loading…</td></tr></tbody></table>
  </div>
  <aside class="card"><h3>Live activity</h3><ul class="feed" id="feed"></ul></aside>
</section>
${user.business && user.business.name ? '' : `<div class="banner">Add your business details so they print on documents. <a href="/app/settings">Business profile →</a> Or just ask Claude to set them.</div>`}
`, '<script src="/static/dashboard.js"></script>');
}

function editor(user, id) {
  return shell(user, 'Edit', 'docs', `<div id="editor" data-id="${Number(id)}"><p class="muted">Loading…</p></div>`, '<script src="/static/editor.js"></script>');
}

function settings(user, saved) {
  const b = user.business || {};
  const f = (k, label, ph = '', type = 'text') => `<label>${label}<input name="${k}" type="${type}" ${type === 'number' ? 'step="0.01"' : ''} value="${esc(b[k])}" placeholder="${esc(ph)}"></label>`;
  const t = (k, label, ph = '') => `<label>${label}<textarea name="${k}" rows="3" placeholder="${esc(ph)}">${esc(b[k])}</textarea></label>`;
  return shell(user, 'Business profile', 'settings', `
<section class="page-head"><div><h1>Business profile</h1><p class="muted">Printed on every invoice and quote. Claude can also update this for you.</p></div></section>
${saved ? '<div class="banner ok">Saved.</div>' : ''}
<form method="post" class="card form-grid">
  ${f('name', 'Business name', 'Studio Saffron')}${f('email', 'Billing email')}${f('phone', 'Phone')}${f('tax_id', 'Tax ID (GSTIN / VAT)')}
  ${t('address', 'Address')}${t('payment_instructions', 'Payment instructions', 'Bank: HDFC · A/C 50100… · IFSC HDFC0001234 · UPI studio@hdfc')}
  ${f('default_currency', 'Default currency', 'USD')}${f('default_tax_rate', 'Default tax %', '18', 'number')}${f('default_tax_label', 'Tax label', 'GST')}
  ${t('default_terms', 'Default invoice terms', 'Payment due within 14 days. Late payments incur 1.5% monthly interest.')}
  <div class="span2"><button class="btn primary">Save profile</button></div>
</form>`);
}

function connect(user) {
  const url = `${M.baseUrl()}/mcp/${user.mcp_token}`;
  return shell(user, 'Connect Claude', 'connect', `
<section class="page-head"><div><h1>Connect your Claude</h1><p class="muted">Paydraft has no AI of its own. Your Claude writes, and Paydraft saves and publishes.</p></div></section>
<div class="card connect">
  <h3>Your private connector URL</h3>
  <div class="copyrow"><code id="mcpurl">${esc(url)}</code><button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('mcpurl').textContent);this.textContent='Copied ✓'">Copy</button></div>
  <p class="muted small">Treat it like a password: anyone with this URL can create documents in your account. <form method="post" action="/app/connect/rotate" style="display:inline"><button class="link">Generate a new one</button></form></p>
  <h3>Add it to Claude (about 30 seconds)</h3>
  <ol class="steps">
    <li>Open <b>claude.ai</b> (or the desktop app) → <b>Settings → Connectors</b>.</li>
    <li>Click <b>Add custom connector</b>. Name it <b>Paydraft</b>, paste the URL above, and click <b>Add</b>. No OAuth is needed.</li>
    <li>In a new chat, open the <b>+ / tools</b> menu and make sure <b>Paydraft</b> is switched on.</li>
    <li>Try: <i>"Invoice Acme Robotics for 32 hours of design at $95/hr plus a $240 testing tool, 18% GST."</i></li>
  </ol>
  <h3>Things to ask</h3>
  <ul class="prompts">
    <li>"Set my business profile: Studio Saffron, Bengaluru, GSTIN 29ABCDE1234F1Z5, pay via UPI studio@hdfc."</li>
    <li>"Write a quote for Northwind: brand refresh, 3 concepts, 2 revision rounds, $4,500."</li>
    <li>"Who owes me money? Draft a polite reminder for the most overdue one."</li>
    <li>"Northwind accepted. Convert their quote to an invoice due in 7 days."</li>
    <li>"Add a 10% loyalty discount to INV-0003 and mark it sent."</li>
  </ul>
</div>`);
}

function statusPill(s) { return `<span class="pill s-${esc(s)}">${esc(s)}</span>`; }

function publicDoc(doc, { justResponded } = {}) {
  const d = doc.data, b = doc.business || {}, t = M.totals(d), cur = d.currency, st = M.effectiveStatus(doc);
  const isQuote = doc.kind === 'quote';
  const rows = d.items.map((it) => `<tr><td>${esc(it.description)}</td><td class="r">${esc(it.quantity)}</td><td class="r">${M.money(it.unit_price, cur)}</td><td class="r">${M.money(it.quantity * it.unit_price, cur)}</td></tr>`).join('');
  const respond = isQuote && st === 'sent' ? `<form method="post" action="/p/${esc(doc.public_id)}/respond" class="respond no-print">
     <button class="btn primary" name="decision" value="accept">Accept quote</button>
     <button class="btn" name="decision" value="decline">Decline</button></form>` : '';
  return `${head(`${doc.number} from ${b.name || doc.owner_name}`)}<body class="public">
<div class="toolbar no-print"><span>${isQuote ? 'Quote' : 'Invoice'} from <b>${esc(b.name || doc.owner_name)}</b></span><button class="btn" onclick="print()">Download PDF</button></div>
${justResponded ? `<div class="banner ok no-print wrap-doc">Thanks, your response has been sent to ${esc(b.name || doc.owner_name)}.</div>` : ''}
<article class="paper">
  <header class="doc-head">
    <div><div class="biz">${esc(b.name || doc.owner_name)}</div><div class="muted small">${nl2br(b.address)}${b.email ? '<br>' + esc(b.email) : ''}${b.phone ? ' · ' + esc(b.phone) : ''}${b.tax_id ? '<br>Tax ID ' + esc(b.tax_id) : ''}</div></div>
    <div class="r"><div class="kind">${isQuote ? 'Quote' : 'Invoice'}</div><div class="mono">${esc(doc.number)}</div>${statusPill(st)}</div>
  </header>
  ${d.title ? `<h2 class="doc-title">${esc(d.title)}</h2>` : ''}
  <section class="meta">
    <div><div class="lbl">Billed to</div><b>${esc(d.client.name)}</b><div class="muted small">${nl2br(d.client.address)}${d.client.email ? '<br>' + esc(d.client.email) : ''}${d.client.tax_id ? '<br>Tax ID ' + esc(d.client.tax_id) : ''}</div></div>
    <div><div class="lbl">Issued</div>${esc(d.issue_date)}</div>
    <div><div class="lbl">${isQuote ? 'Valid until' : 'Due'}</div>${esc(d.due_date)}</div>
    <div class="r"><div class="lbl">${isQuote ? 'Total' : 'Amount due'}</div><div class="big mono">${M.money(st === 'paid' ? 0 : t.total, cur)}</div></div>
  </section>
  <table class="lines"><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="sum">
    <tr><td>Subtotal</td><td class="r">${M.money(t.subtotal, cur)}</td></tr>
    ${t.discount ? `<tr><td>Discount</td><td class="r">−${M.money(t.discount, cur)}</td></tr>` : ''}
    ${d.tax_rate ? `<tr><td>${esc(d.tax_label)} ${esc(d.tax_rate)}%</td><td class="r">${M.money(t.tax, cur)}</td></tr>` : ''}
    <tr class="grand"><td>Total</td><td class="r">${M.money(t.total, cur)}</td></tr>
    ${st === 'paid' ? `<tr><td>Paid ${esc(d.paid_at || '')}</td><td class="r">−${M.money(d.paid_amount ?? t.total, cur)}</td></tr>` : ''}
  </table>
  ${d.notes ? `<section class="block"><div class="lbl">Notes</div>${nl2br(d.notes)}</section>` : ''}
  ${d.terms ? `<section class="block"><div class="lbl">Terms</div>${nl2br(d.terms)}</section>` : ''}
  ${!isQuote && b.payment_instructions ? `<section class="block pay"><div class="lbl">How to pay</div>${nl2br(b.payment_instructions)}</section>` : ''}
  ${respond}
  <footer class="muted small">Sent with Paydraft</footer>
</article></body></html>`;
}

module.exports = { landing, authPage, dashboard, editor, settings, connect, publicDoc, esc };
