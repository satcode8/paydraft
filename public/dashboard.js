(() => {
  let filter = 'all', data = null, known = null;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n, c) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: c || 'USD', maximumFractionDigits: 0 }).format(n || 0); } catch { return c + ' ' + Math.round(n); } };
  const ago = (t) => { const s = (Date.now() - new Date(t)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return new Date(t).toLocaleDateString(); };
  const src = (s) => s === 'claude' ? '<span class="src claude">✶ Claude</span>' : s === 'client' ? '<span class="src client">Client</span>' : '<span class="src you">You</span>';

  function render() {
    const rec = data.receivables; const curs = Object.keys(rec); const c = curs[0] || 'USD'; const r = rec[c] || { outstanding: 0, overdue: 0, paid_last_30_days: 0, draft: 0 };
    const quotesOpen = data.documents.filter((d) => d.kind === 'quote' && d.status === 'sent');
    document.getElementById('stats').innerHTML = `
      <div class="stat"><div class="lbl">Outstanding</div><div class="v mono">${money(r.outstanding, c)}</div></div>
      <div class="stat warn"><div class="lbl">Overdue</div><div class="v mono">${money(r.overdue, c)}</div></div>
      <div class="stat good"><div class="lbl">Paid · last 30 days</div><div class="v mono">${money(r.paid_last_30_days, c)}</div></div>
      <div class="stat"><div class="lbl">Open quotes</div><div class="v mono">${quotesOpen.length} · ${money(quotesOpen.reduce((s, q) => s + q.total, 0), c)}</div></div>
      ${curs.length > 1 ? `<div class="muted small span4">Showing ${c}. Also tracking ${curs.slice(1).join(', ')}.</div>` : ''}`;
    let docs = data.documents;
    if (filter === 'invoice' || filter === 'quote') docs = docs.filter((d) => d.kind === filter);
    if (filter === 'overdue') docs = docs.filter((d) => d.status === 'overdue');
    if (filter === 'claude') docs = docs.filter((d) => d.created_via === 'claude');
    document.getElementById('rows').innerHTML = docs.map((d) => `
      <tr class="${known && !known.has(d.id) ? 'new' : ''}" onclick="location.href='/app/doc/${d.id}'">
        <td><span class="mono">${esc(d.number)}</span> ${d.created_via === 'claude' ? '<span class="dot" title="Written by Claude">✶</span>' : ''}<div class="muted small">${esc(d.title || (d.kind === 'quote' ? 'Quote' : 'Invoice'))}</div></td>
        <td>${esc(d.client.name || '—')}</td>
        <td><span class="pill s-${esc(d.status)}">${esc(d.status)}</span>${d.days_overdue ? `<div class="small warn-t">${d.days_overdue}d late</div>` : ''}</td>
        <td class="small">${esc(d.due_date)}</td>
        <td class="r mono">${esc(d.total_formatted)}</td></tr>`).join('') || `<tr><td colspan="5" class="empty">Nothing here yet. Ask Claude: <i>"Invoice Acme for 10 hours of consulting at $120/hr."</i></td></tr>`;
    document.getElementById('feed').innerHTML = data.feed.map((e) => `<li>${src(e.source)} <a href="/app/doc/${e.doc_id}" class="mono">${esc(e.number)}</a> <span>${esc(e.detail || e.action)}</span><time>${ago(e.at)}</time></li>`).join('') || '<li class="muted">Waiting for your first document…</li>';
    known = new Set(data.documents.map((d) => d.id));
  }

  document.getElementById('filters').addEventListener('click', (e) => {
    const f = e.target.dataset.f; if (!f) return; filter = f;
    document.querySelectorAll('#filters button').forEach((b) => b.classList.toggle('on', b.dataset.f === f)); render();
  });

  async function poll() {
    try { const r = await fetch('/api/documents'); if (r.status === 401) return location.href = '/login'; data = await r.json(); render(); } catch {}
  }
  poll(); setInterval(() => { if (!document.hidden) poll(); }, 3000);
})();
