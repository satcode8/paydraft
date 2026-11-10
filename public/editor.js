(() => {
  const root = document.getElementById('editor');
  const id = root.dataset.id;
  let state = null;        // { doc, events, statuses, business }
  let dirty = false, saving = false, timer = null, lastSeen = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n, c) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD' }).format(n || 0); } catch { return (c || '') + ' ' + Number(n || 0).toFixed(2); } };
  const ago = (t) => { const s = (Date.now() - new Date(t)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return new Date(t).toLocaleDateString(); };
  const srcBadge = (s) => s === 'claude' ? '<span class="src claude">✶ Claude</span>' : s === 'client' ? '<span class="src client">Client</span>' : '<span class="src you">You</span>';
  const api = async (method, url, body) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Request failed');
    return j;
  };

  async function load() {
    state = await api('GET', `/api/documents/${id}`);
    lastSeen = state.doc.updated_at;
    render();
  }

  function itemRow(it, i) {
    return `<tr data-i="${i}">
      <td><textarea class="in desc" rows="1" data-k="description" placeholder="What did you deliver?">${esc(it.description)}</textarea></td>
      <td><input class="in r" data-k="quantity" type="number" step="any" value="${esc(it.quantity)}"></td>
      <td><input class="in r" data-k="unit_price" type="number" step="0.01" value="${esc(it.unit_price)}"></td>
      <td class="r mono amt">${money(it.quantity * it.unit_price, state.doc.data.currency)}</td>
      <td><button class="x" title="Remove line" data-del="${i}">×</button></td></tr>`;
  }

  function render() {
    const { doc, statuses } = state; const d = doc.data; const isQuote = doc.kind === 'quote';
    document.title = `${doc.number} · Paydraft`;
    root.innerHTML = `
<section class="page-head">
  <div><a href="/app" class="muted small">← All documents</a>
    <h1>${isQuote ? 'Quote' : 'Invoice'} <span class="mono">${esc(doc.number)}</span> <span class="pill s-${esc(doc.status)}">${esc(doc.status)}</span>
    ${doc.created_via === 'claude' ? '<span class="src claude">✶ Written by Claude</span>' : ''}</h1></div>
  <div class="actions">
    <span id="savestate" class="muted small">All changes saved</span>
    <a class="btn" href="${esc(doc.public_url)}" target="_blank">Client view ↗</a>
    <button class="btn" id="copy">Copy client link</button>
  </div>
</section>
<div id="live" class="banner live" hidden></div>
<section class="grid2 editor-grid">
  <div class="card">
    <div class="statusbar">${statuses.filter((s) => s !== 'converted').map((s) => `<button class="chip ${doc.stored_status === s ? 'on' : ''}" data-status="${s}">${s === 'paid' ? '✓ Paid' : s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
      ${isQuote && doc.stored_status !== 'converted' ? '<button class="chip accent" id="convert">Convert to invoice →</button>' : ''}</div>
    <label class="full">Title<input class="in" data-f="title" value="${esc(d.title)}" placeholder="e.g. March design retainer"></label>
    <div class="form-grid">
      <label>Client name<input class="in" data-c="name" value="${esc(d.client.name)}"></label>
      <label>Client email<input class="in" data-c="email" value="${esc(d.client.email)}"></label>
      <label>Client address<textarea class="in" data-c="address" rows="2">${esc(d.client.address)}</textarea></label>
      <label>Client tax ID<input class="in" data-c="tax_id" value="${esc(d.client.tax_id)}"></label>
      <label>Issue date<input class="in" type="date" data-f="issue_date" value="${esc(d.issue_date)}"></label>
      <label>${isQuote ? 'Valid until' : 'Due date'}<input class="in" type="date" data-f="due_date" value="${esc(d.due_date)}"></label>
    </div>
    <table class="items"><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th><th></th></tr></thead>
      <tbody id="items">${d.items.map(itemRow).join('')}</tbody></table>
    <button class="btn small" id="addline">+ Add line</button>
    <div class="totals-row">
      <div class="form-grid three">
        <label>Currency<input class="in" data-f="currency" maxlength="3" value="${esc(d.currency)}"></label>
        <label>Discount<input class="in" type="number" step="0.01" data-f="discount" value="${esc(d.discount)}"></label>
        <label>Tax %<input class="in" type="number" step="any" data-f="tax_rate" value="${esc(d.tax_rate)}"></label>
        <label>Tax label<input class="in" data-f="tax_label" value="${esc(d.tax_label)}"></label>
      </div>
      <table class="sum" id="sum"></table>
    </div>
    <label class="full">Notes to client<textarea class="in" data-f="notes" rows="3">${esc(d.notes)}</textarea></label>
    <label class="full">Terms<textarea class="in" data-f="terms" rows="3">${esc(d.terms)}</textarea></label>
    <div class="danger"><button class="link" id="del">Delete ${doc.kind}</button></div>
  </div>
  <aside class="card"><h3>Activity</h3><ul class="feed" id="feed"></ul>
    <p class="muted small">Claude sees this same history through <code>get_document</code>, so it knows what you changed by hand.</p></aside>
</section>`;
    renderSum(); renderFeed(); bind(); autosize();
  }

  function renderSum() {
    const d = state.doc.data;
    const sub = d.items.reduce((s, it) => s + (+it.quantity || 0) * (+it.unit_price || 0), 0);
    const disc = Math.min(sub, +d.discount || 0); const tax = (sub - disc) * (+d.tax_rate || 0) / 100;
    document.getElementById('sum').innerHTML = `
      <tr><td>Subtotal</td><td class="r mono">${money(sub, d.currency)}</td></tr>
      ${disc ? `<tr><td>Discount</td><td class="r mono">−${money(disc, d.currency)}</td></tr>` : ''}
      ${+d.tax_rate ? `<tr><td>${esc(d.tax_label)} ${esc(d.tax_rate)}%</td><td class="r mono">${money(tax, d.currency)}</td></tr>` : ''}
      <tr class="grand"><td>Total</td><td class="r mono">${money(sub - disc + tax, d.currency)}</td></tr>`;
    document.querySelectorAll('#items tr').forEach((tr) => { const it = d.items[tr.dataset.i]; if (it) tr.querySelector('.amt').textContent = money((+it.quantity || 0) * (+it.unit_price || 0), d.currency); });
  }

  function renderFeed() {
    document.getElementById('feed').innerHTML = state.events.map((e) => `<li>${srcBadge(e.source)} <span>${esc(e.detail || e.action)}</span><time>${ago(e.at)}</time></li>`).join('') || '<li class="muted">No activity yet</li>';
  }

  function autosize() { document.querySelectorAll('textarea.desc').forEach((t) => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }); }

  function markDirty() {
    dirty = true; document.getElementById('savestate').textContent = 'Editing…';
    renderSum(); clearTimeout(timer); timer = setTimeout(save, 900);
  }

  async function save() {
    if (saving) { timer = setTimeout(save, 400); return; }
    saving = true; document.getElementById('savestate').textContent = 'Saving…';
    const d = state.doc.data;
    try {
      const r = await api('PUT', `/api/documents/${id}`, { title: d.title, client: d.client, issue_date: d.issue_date, due_date: d.due_date, items: d.items, currency: d.currency, discount: +d.discount || 0, tax_rate: +d.tax_rate || 0, tax_label: d.tax_label, notes: d.notes, terms: d.terms });
      state.doc = { ...state.doc, ...r.doc }; lastSeen = r.doc.updated_at; dirty = false;
      document.getElementById('savestate').textContent = 'Saved ✓';
      refreshMeta();
    } catch (e) { document.getElementById('savestate').textContent = '⚠ ' + e.message; }
    saving = false;
  }

  async function refreshMeta() { const j = await api('GET', `/api/documents/${id}`); state.events = j.events; renderFeed(); }

  function bind() {
    const d = state.doc.data;
    root.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('input', () => { d[el.dataset.f] = el.dataset.f === 'currency' ? el.value.toUpperCase() : el.value; markDirty(); }));
    root.querySelectorAll('[data-c]').forEach((el) => el.addEventListener('input', () => { d.client[el.dataset.c] = el.value; markDirty(); }));
    document.getElementById('items').addEventListener('input', (e) => {
      const tr = e.target.closest('tr'); const k = e.target.dataset.k; if (!tr || !k) return;
      d.items[tr.dataset.i][k] = k === 'description' ? e.target.value : e.target.value === '' ? 0 : +e.target.value;
      autosize(); markDirty();
    });
    document.getElementById('items').addEventListener('click', (e) => {
      if (e.target.dataset.del == null) return; d.items.splice(+e.target.dataset.del, 1); rerenderItems(); markDirty();
    });
    document.getElementById('addline').onclick = () => { d.items.push({ description: '', quantity: 1, unit_price: 0 }); rerenderItems(); document.querySelector('#items tr:last-child textarea').focus(); };
    document.getElementById('copy').onclick = (e) => { navigator.clipboard.writeText(state.doc.public_url); e.target.textContent = 'Copied ✓'; setTimeout(() => (e.target.textContent = 'Copy client link'), 1500); };
    root.querySelectorAll('[data-status]').forEach((b) => b.onclick = async () => {
      if (dirty) await save();
      try { await api('POST', `/api/documents/${id}/status`, { status: b.dataset.status }); await load(); } catch (err) { alert(err.message); }
    });
    const cv = document.getElementById('convert');
    if (cv) cv.onclick = async () => { if (dirty) await save(); const r = await api('POST', `/api/documents/${id}/convert`); location.href = `/app/doc/${r.doc.id}`; };
    document.getElementById('del').onclick = async () => { if (!confirm(`Delete ${state.doc.number}? This can't be undone.`)) return; await api('DELETE', `/api/documents/${id}`); location.href = '/app'; };
    document.onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); clearTimeout(timer); save(); } };
  }

  function rerenderItems() { document.getElementById('items').innerHTML = state.doc.data.items.map(itemRow).join(''); autosize(); renderSum(); }

  // Live: if Claude (or another tab) changes this document, pull it in.
  setInterval(async () => {
    if (!state || saving || document.hidden) return;
    try {
      const j = await api('GET', `/api/documents/${id}`);
      if (j.doc.updated_at === lastSeen) { state.events = j.events; renderFeed(); return; }
      const who = j.events[0] && j.events[0].source === 'claude' ? 'Claude' : j.events[0] && j.events[0].source === 'client' ? 'Your client' : 'Another tab';
      if (dirty) { const b = document.getElementById('live'); b.hidden = false; b.innerHTML = `${who} just changed this document. <button class="link" onclick="location.reload()">Reload</button>`; lastSeen = j.doc.updated_at; return; }
      state = j; lastSeen = j.doc.updated_at; render();
      const b = document.getElementById('live'); b.hidden = false; b.textContent = `✶ ${who} updated this just now: ${j.events[0] ? j.events[0].detail : ''}`;
      setTimeout(() => { b.hidden = true; }, 6000);
    } catch {}
  }, 3000);

  load().catch((e) => { root.innerHTML = `<div class="card">Could not load: ${esc(e.message)}</div>`; });
})();
