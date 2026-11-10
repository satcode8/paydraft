(() => {
  let filter = 'all', data = null, known = null;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n, c) => { try { return new Intl.NumberFormat(c === 'INR' || !c ? 'en-IN' : 'en-US', { style: 'currency', currency: c || 'INR', maximumFractionDigits: 0 }).format(n || 0); } catch { return c + ' ' + Math.round(n); } };
  const ago = (t) => { const s = (Date.now() - new Date(t)) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return new Date(t).toLocaleDateString(); };
  const src = (s) => s === 'claude' ? '<span class="src claude">✶ Claude</span>' : s === 'client' ? '<span class="src client">Client</span>' : '<span class="src you">You</span>';

  function render() {
    const rec = data.receivables; const curs = Object.keys(rec); const c = curs.includes('INR') ? 'INR' : (curs[0] || 'INR');
    const r = rec[c] || { to_collect: 0, overdue: 0 };
    const nOver = data.documents.filter((d) => d.status === 'overdue' && d.currency === c).length;
    const nOpen = data.documents.filter((d) => (d.status === 'unpaid' || d.status === 'overdue') && d.currency === c).length;
    document.getElementById('stats').innerHTML = `
      <div class="stat"><div class="lbl">To collect</div><div class="v mono">${money(r.to_collect, c)}</div><div class="small muted">${nOpen} unpaid invoice${nOpen === 1 ? '' : 's'}</div></div>
      <div class="stat warn"><div class="lbl">Overdue</div><div class="v mono">${money(r.overdue, c)}</div><div class="small muted">${nOver ? nOver + ' past due date' : 'Nothing late'}</div></div>`;
    let docs = data.documents;
    if (filter === 'invoice' || filter === 'quote') docs = docs.filter((d) => d.kind === filter);
        document.getElementById('rows').innerHTML = docs.map((d) => `
      <tr class="${known && !known.has(d.id) ? 'new' : ''}" onclick="location.href='/app/doc/${d.id}'">
        <td><span class="mono">${esc(d.number)}</span> ${d.created_via === 'claude' ? '<span class="dot" title="Written by Claude">✶</span>' : ''}<div class="muted small">${esc(d.title || (d.kind === 'quote' ? 'Quote' : 'Invoice'))}</div></td>
        <td>${esc(d.client.name || '—')}</td>
        <td><span class="pill s-${esc(d.status)}">${esc(d.status)}</span>${d.days_overdue ? `<div class="small warn-t">${d.days_overdue}d late</div>` : ''}</td>
        <td class="small">${esc(d.due_date)}</td>
        <td class="r mono">${esc(d.total_formatted)}</td></tr>`).join('') || `<tr><td colspan="5" class="empty">Nothing here yet. Ask Claude: <i>"Invoice Acme for 10 hours of consulting at ₹3,000/hr."</i></td></tr>`;
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
