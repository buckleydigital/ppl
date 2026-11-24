'use strict'
// Admin portal. Showing this page grants nothing: every admin call is checked
// for the admin role on the server and recorded in the audit log.
;(function () {
  const { cfg, client, call, $, $$, esc, brandLogo, mountSignIn, mountViews, signOut } = window.App
  const PATH = '/admin/'
  $$('[data-logo]').forEach(brandLogo)
  const money = (c) => (Number(c) < 0 ? '-' : '') + '$' + (Math.abs(Number(c || 0)) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const when = (t) => t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''
  const table = (heads, rows) => rows.length
    ? `<div class="table-wrap"><table class="list"><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">Nothing here.</p>'
  const kv = (rows) => rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span>${v}</span></div>`).join('')
  const A = (body) => call('admin', body)

  function flash(text, kind = 'ok') {
    const f = $('#flash')
    f.className = `msg ${kind}`
    f.textContent = text
    f.classList.remove('hidden')
    clearTimeout(flash.t)
    flash.t = setTimeout(() => f.classList.add('hidden'), 6000)
    scrollTo({ top: 0, behavior: 'smooth' })
  }
  async function act(fn, ok) {
    try { const r = await fn(); if (ok) flash(ok); return r } catch (e) { flash(e.message, 'err'); throw e }
  }
  const page = (name) => $$('[data-page]').forEach((p) => p.classList.toggle('hidden', p.dataset.page !== name))

  // ── dashboard ──
  async function dashboard() {
    const d = await A({ action: 'dashboard' })
    const max = Math.max(1, ...d.per_day.map((x) => x.received))
    $('#p-dashboard').innerHTML = `
      <div class="grid">${[['Revenue (ex GST)', money(d.revenue_ex_cents)], ['Credits % of revenue', d.credits_pct_of_revenue + '%'], ['Unrouted leads', `<a href="#leads?unrouted">${d.unrouted}</a>`], ['Failed payments', d.payment_failed]]
        .map(([k, v]) => `<div class="card stat"><span class="muted small">${k}</span><b>${v}</b></div>`).join('')}</div>
      <div class="card" style="margin-top:16px"><h2>Leads per day</h2>
        <div style="display:flex;align-items:flex-end;gap:3px;height:120px;margin-top:10px" role="img" aria-label="Leads per day">${d.per_day.map((x) => `
          <div title="${esc(x.date)}: ${x.received} received, ${x.delivered} delivered" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
            <div style="height:${(x.received - x.delivered) / max * 100}%;background:var(--line)"></div><div style="height:${x.delivered / max * 100}%;background:var(--accent);border-radius:2px 2px 0 0"></div></div>`).join('') || '<p class="muted">No leads yet.</p>'}</div>
        <p class="muted small" style="margin-top:6px">Blue: delivered. Grey: not delivered.</p></div>
      <div class="card" style="margin-top:16px"><h2>Margin by lead type and region</h2>
        ${table(['Lead type', 'Region', 'Leads', 'Revenue', 'Ad spend', 'Cost per lead', 'Margin'], d.margin.map((m) => [esc(m.lead_type), esc(m.region), m.leads, money(m.revenue), money(m.spend), m.cpl == null ? '-' : money(m.cpl), `<b style="color:${m.margin < 0 ? '#B42318' : 'inherit'}">${money(m.margin)}</b>`]))}</div>
      <div class="card" style="margin-top:16px"><h2>Open alerts</h2>
        ${table(['When', 'Kind', 'Details', ''], d.alerts.map((a) => [esc(when(a.created_at)), esc(a.kind.replace(/_/g, ' ')), `<span class="small">${esc(JSON.stringify(a.payload).slice(0, 220))}</span>${a.buyer_id ? ` <a href="#customer/${esc(a.buyer_id)}">customer</a>` : ''}`, `<button class="btn link" data-resolve="${esc(a.id)}">Resolve</button>`]))}</div>`
    $$('[data-resolve]').forEach((b) => b.onclick = async () => { await act(() => A({ action: 'resolve_alert', id: b.dataset.resolve }), 'Resolved'); dashboard() })
  }

  // ── customers ──
  async function customers() {
    const box = $('#p-customers')
    if (!box.dataset.ready) {
      box.innerHTML = `<div class="filters"><input type="search" id="c-q" placeholder="Search business or email"><select id="c-status"><option value="">All statuses</option>${['active', 'paused', 'payment_failed', 'disputed', 'dormant', 'pending'].map((s) => `<option>${s}</option>`).join('')}</select><span></span></div><div id="c-list"></div>`
      box.dataset.ready = '1'
      $('#c-q').oninput = () => { clearTimeout(customers.t); customers.t = setTimeout(customers, 300) }
      $('#c-status').onchange = customers
    }
    const r = await A({ action: 'customers', q: $('#c-q').value, status: $('#c-status').value })
    $('#c-list').innerHTML = table(['Business', 'Email', 'Status', 'Cap', 'Joined'], r.customers.map((c) => [
      `<a href="#customer/${esc(c.id)}">${esc(c.business_name)}</a>${c.is_imported ? ' <span class="badge">imported</span>' : ''}`, esc(c.email), `<span class="badge ${c.status === 'active' ? 'ok' : 'warn'}">${esc(c.status)}</span>`, c.weekly_cap, esc(when(c.created_at))]))
  }

  async function customer(id) {
    page('customer')
    const box = $('#p-customer')
    box.innerHTML = '<p class="muted">Loading...</p>'
    const r = await A({ action: 'customer', id })
    const b = r.buyer
    const op = (o, extra = {}) => act(() => A({ action: 'customer_action', id, op: o, ...extra }), 'Done').then(() => customer(id))
    box.innerHTML = `
      <div class="page-head"><div><h1>${esc(b.business_name)}</h1><p class="muted">${esc(b.email)} · ${esc(b.phone || '')}</p></div>
        <div class="row-actions">
          <button class="btn" data-op="send_card_link">Send card link</button>
          ${b.status === 'active' ? '<button class="btn" data-op="pause">Pause</button>' : `<button class="btn primary" data-op="${b.is_imported && !b.activated_at ? 'activate' : 'resume'}">${b.is_imported && !b.activated_at ? 'Activate' : 'Resume'}</button>`}
        </div></div>
      <div class="grid">${[['Status', `<span class="badge ${b.status === 'active' ? 'ok' : 'warn'}">${esc(b.status)}</span> ${esc(b.paused_reason || '')}`], ['This week', `${r.this_week} / ${b.weekly_cap}`], ['Credit', money(r.credit_cents)], ['Card', b.card_last4 ? `${esc(b.card_brand)} •••• ${esc(b.card_last4)}` : 'none'], ['Prepaid lead', esc(b.prepaid_status)]]
        .map(([k, v]) => `<div class="card stat"><span class="muted small">${k}</span><b style="font-size:17px">${v}</b></div>`).join('')}</div>
      ${r.name_requests.length ? `<div class="card" style="margin-top:16px"><h2>Business name change</h2>${r.name_requests.map((n) => `<p>${esc(n.current_name)} &rarr; <b>${esc(n.requested)}</b> <button class="btn" data-name="${esc(n.id)}" data-approve="1">Approve</button> <button class="btn" data-name="${esc(n.id)}" data-approve="0">Deny</button></p>`).join('')}</div>` : ''}
      <div class="card" style="margin-top:16px"><h2>Details</h2>${kv([['Legal name', esc(b.legal_name || '')], ['ABN', esc(b.abn || '')], ['Contact', esc(b.contact_name || '')], ['Lead types', esc(r.lead_types.map((t) => t.name).join(', '))], ['Authorised', esc(b.authorisation_text || '')], ['Webhook', esc(b.crm_webhook_url || '')], ['AI follow-up', b.ai_followup_enabled ? 'On' : 'Off']])}</div>
      <div class="card" style="margin-top:16px"><h2>Areas</h2>${table(['Area', 'Type', 'Region', 'Postcodes', 'Status'], r.areas.map((a) => [esc(a.label), esc(a.location_type), esc(a.region || ''), a.postcode_count, esc(a.status)]))}</div>
      <div class="card" style="margin-top:16px"><h2>Actions</h2>
        <form class="inline-form" id="f-cap"><label>Weekly cap</label><input type="number" name="v" value="${b.weekly_cap}" min="1"><button class="btn">Save</button></form>
        <form class="inline-form" id="f-credit" style="margin-top:10px"><label>Adjust credit (cents)</label><input type="number" name="v" placeholder="10500 or -10500"><input name="note" placeholder="Reason" style="width:220px"><button class="btn">Apply</button></form>
        <form class="inline-form" id="f-charge" style="margin-top:10px"><label>Manual charge (cents ex GST)</label><input type="number" name="v" min="1"><input name="note" placeholder="Description" style="width:220px"><button class="btn">Charge card</button></form>
        <form class="inline-form" id="f-types" style="margin-top:10px"><label>Lead types</label><input name="v" value="${esc(r.lead_types.map((t) => t.slug).join(','))}" style="width:320px"><button class="btn">Save</button></form>
      </div>
      <div class="card" style="margin-top:16px"><h2>Charges</h2>${table(['Date', 'Kind', 'Charged', 'Credit', 'Status', ''], r.charges.map((c) => [esc(when(c.created_at)), esc(c.kind), money(c.amount_inc_gst_cents), money(c.credit_applied_cents), esc(c.status) + (c.error ? `<div class="small muted">${esc(c.error)}</div>` : '') + (c.refunded_cents ? `<div class="small muted">refunded ${money(c.refunded_cents)}</div>` : ''),
        c.status === 'succeeded' && c.amount_inc_gst_cents > c.refunded_cents ? `<button class="btn link" data-refund="${esc(c.id)}">Refund</button>` : '']))}</div>
      <div class="card" style="margin-top:16px"><h2>Credit ledger</h2>${table(['Date', 'Change', 'Reason', 'Note'], r.ledger.map((l) => [esc(when(l.created_at)), money(l.delta_cents), esc(l.reason), esc(l.note || '')]))}</div>
      <div class="card" style="margin-top:16px"><h2>Audit trail</h2>${table(['When', 'Action', 'By', 'Change'], r.audit.map((a) => [esc(when(a.created_at)), esc(a.action), esc(a.actor_kind), `<span class="small">${esc(JSON.stringify(a.after || '').slice(0, 160))}</span>`]))}</div>`
    $$('[data-op]', box).forEach((x) => x.onclick = () => op(x.dataset.op))
    $$('[data-name]', box).forEach((x) => x.onclick = () => op('approve_name', { request_id: x.dataset.name, approve: x.dataset.approve === '1' }))
    $$('[data-refund]', box).forEach((x) => x.onclick = () => { const v = prompt('Refund amount in cents (blank = full refund)'); if (v === null) return; op('refund', { charge_id: x.dataset.refund, cents: v ? Number(v) : undefined }) })
    $('#f-cap').onsubmit = (e) => { e.preventDefault(); op('set_cap', { weekly_cap: Number(e.target.v.value) }) }
    $('#f-credit').onsubmit = (e) => { e.preventDefault(); op('adjust_credit', { cents: Number(e.target.v.value), note: e.target.note.value }) }
    $('#f-charge').onsubmit = (e) => { e.preventDefault(); if (confirm('Charge this customer\'s card now?')) op('manual_charge', { ex_cents: Number(e.target.v.value), description: e.target.note.value }) }
    $('#f-types').onsubmit = (e) => { e.preventDefault(); op('set_lead_types', { lead_types: e.target.v.value.split(',').map((s) => s.trim()).filter(Boolean) }) }
  }

  // ── leads ──
  async function leads(status) {
    const box = $('#p-leads')
    if (!box.dataset.ready) {
      box.innerHTML = `<div class="filters"><input type="search" id="l-q" placeholder="Name, postcode or phone"><select id="l-status"><option value="">All</option>${['delivered', 'unrouted', 'duplicate', 'charging', 'received'].map((s) => `<option>${s}</option>`).join('')}</select><span></span></div><div id="l-list"></div>`
      box.dataset.ready = '1'
      $('#l-q').oninput = () => { clearTimeout(leads.t); leads.t = setTimeout(() => leads(), 300) }
      $('#l-status').onchange = () => leads()
    }
    if (status) $('#l-status').value = status
    const r = await A({ action: 'leads', q: $('#l-q').value, status: $('#l-status').value })
    $('#l-list').innerHTML = `<p class="muted small">${r.total} leads</p>` + table(['Received', 'Name', 'Type', 'Postcode', 'Status', 'Buyer'], r.leads.map((l) => [
      esc(when(l.created_at)), `<a href="#lead/${esc(l.id)}">${esc([l.first_name, l.last_name].filter(Boolean).join(' '))}</a>`, esc(l.lead_types?.name || ''), esc([l.suburb, l.postcode].filter(Boolean).join(' ')),
      `<span class="badge ${l.status === 'delivered' ? 'ok' : 'warn'}">${esc(l.status)}</span>${l.unrouted_reason ? `<div class="small muted">${esc(l.unrouted_reason.replace(/_/g, ' '))}</div>` : ''}`, esc(l.buyers?.business_name || '')]))
  }

  async function lead(id) {
    page('lead')
    const box = $('#p-lead')
    box.innerHTML = '<p class="muted">Loading...</p>'
    const r = await A({ action: 'lead', id })
    const l = r.lead
    box.innerHTML = `
      <div class="page-head"><div><h1>${esc([l.first_name, l.last_name].join(' '))}</h1><p class="muted">${esc(l.lead_types?.name || l.lead_type_raw)} · ${esc([l.suburb, l.postcode].filter(Boolean).join(' '))} · <span class="badge">${esc(l.status)}</span> ${esc(l.unrouted_reason || '')}</p></div>
        ${['unrouted', 'received'].includes(l.status) ? `<div class="row-actions"><button class="btn primary" id="reroute">Re-run routing</button><button class="btn" id="reassign">Send to a buyer...</button></div>` : ''}</div>
      <div class="card">${kv([['Phone', esc(l.phone_e164)], ['Email', esc(l.email || '')], ['Source', esc(l.source || '')], ['Buyer', esc(l.buyers?.business_name || '')], ['Delivered', esc(when(l.delivered_at))], ['Details', `<span class="small">${esc(JSON.stringify(l.details))}</span>`]])}</div>
      <div class="card" style="margin-top:16px"><h2>Consent</h2><p>${esc(r.consent?.consent_text || 'None')}</p></div>
      <div class="card" style="margin-top:16px"><h2>Verification</h2>${table(['Check', 'Passed', 'Result'], (r.verifications || []).map((v) => [esc(v.check_name), v.passed ? 'yes' : '<b>no</b>', `<span class="small">${esc(JSON.stringify(v.result))}</span>`]))}</div>
      <div class="card" style="margin-top:16px"><h2>Routing log</h2>${table(['When', 'Rule', 'Chosen', 'Outcome', 'Eligible'], (r.routing || []).map((x) => [esc(when(x.created_at)), esc(x.rule), esc(x.chosen_buyer_id || ''), esc(x.outcome) + (x.reason ? `<div class="small muted">${esc(x.reason)}</div>` : ''), `<span class="small">${esc((x.eligible || []).map((e) => `${e.name} ${e.used}/${e.cap}`).join('; '))}</span>`]))}</div>
      <div class="card" style="margin-top:16px"><h2>Charges and delivery</h2>${table(['Status', 'Charged', 'Credit', 'Error'], (r.charges || []).map((c) => [esc(c.status), money(c.amount_inc_gst_cents), money(c.credit_applied_cents), esc(c.error || '')]))}${table(['Channel', 'Status', 'To', 'Code'], (r.deliveries || []).map((d) => [esc(d.channel), esc(d.status), esc(d.destination || ''), esc(d.response_code ?? '')]))}</div>
      ${(r.sms || []).length ? `<div class="card" style="margin-top:16px"><h2>Texts</h2>${r.sms.map((m) => `<div class="bubble ${m.direction === 'inbound' ? 'in' : 'out'}">${esc(m.body)}</div>`).join('')}</div>` : ''}`
    const rr = $('#reroute'), ra = $('#reassign')
    if (rr) rr.onclick = async () => { const x = await act(() => call('lead-route', { lead_id: id })); flash(x.status === 'delivered' ? 'Delivered' : `Still unrouted: ${x.reason}`, x.status === 'delivered' ? 'ok' : 'err'); lead(id) }
    if (ra) ra.onclick = async () => { const b = prompt('Buyer id to send this lead to (it is charged to them first)'); if (!b) return; const x = await act(() => call('lead-route', { lead_id: id, buyer_id: b.trim() })); flash(x.status === 'delivered' ? 'Delivered' : `Not delivered: ${x.reason}`, x.status === 'delivered' ? 'ok' : 'err'); lead(id) }
  }

  // ── claims ──
  async function claims() {
    const r = await A({ action: 'claims', status: 'pending' })
    $('#p-claims').innerHTML = table(['When', 'Customer', 'Lead', 'Reason', 'Evidence', 'Credit', ''], r.claims.map((c) => [
      esc(when(c.created_at)), esc(c.buyers?.business_name || ''), `<a href="#lead/${esc(c.lead_id)}">${esc([c.leads?.first_name, c.leads?.last_name].join(' '))}</a> ${esc(c.leads?.postcode || '')}`,
      esc(c.reason.replace(/_/g, ' ')) + (c.notes ? `<div class="small muted">${esc(c.notes)}</div>` : ''), `<span class="small">${esc(JSON.stringify(c.evidence).slice(0, 200))}</span>`, money(c.amount_ex_cents),
      `<button class="btn" data-claim="${esc(c.id)}" data-ok="1">Approve</button> <button class="btn" data-claim="${esc(c.id)}" data-ok="0">Deny</button>`]))
    $$('[data-claim]').forEach((b) => b.onclick = async () => {
      const approve = b.dataset.ok === '1'
      const reason = approve ? (prompt('Note (optional)') ?? '') : prompt('Reason for denying (sent to the customer)')
      if (!approve && !reason) return
      await act(() => call('claims', { action: 'decide', id: b.dataset.claim, approve, reason }), approve ? 'Approved: credit added' : 'Denied')
      claims()
    })
  }

  // ── pricing ──
  async function pricing() {
    const r = await A({ action: 'pricing' })
    const def = (t) => r.prices.find((p) => p.lead_type_id === t.id && !p.region_id)
    const overrides = (t) => r.prices.filter((p) => p.lead_type_id === t.id && p.region_id)
    const rn = Object.fromEntries(r.regions.map((g) => [g.id, g.name]))
    $('#p-pricing').innerHTML = table(['Lead type', 'Sold', 'Default price', 'Region overrides', ''], r.lead_types.map((t) => {
      const d = def(t)
      return [`<b>${esc(t.name)}</b><div class="small muted">${esc(t.lead_categories?.name || '')}</div>`,
        `<label class="small"><input type="checkbox" data-active="${esc(t.slug)}"${t.active && !t.parked ? ' checked' : ''}> ${t.parked ? 'parked' : t.active ? 'on' : 'off'}</label>`,
        `<form class="inline-form" data-price="${esc(t.slug)}"><input type="number" step="0.01" value="${d ? (d.price_ex_gst_cents / 100).toFixed(2) : ''}" aria-label="Default price"><button class="btn">Save</button></form>${d?.is_placeholder ? '<span class="badge warn">placeholder</span>' : ''}`,
        overrides(t).map((o) => `<div class="small">${esc(rn[o.region_id])}: ${money(o.price_ex_gst_cents)}${o.sold_out ? ' (sold out)' : ''} <button class="btn link" data-rm="${esc(t.slug)}|${esc(rn[o.region_id])}">remove</button></div>`).join(''),
        `<form class="inline-form" data-override="${esc(t.slug)}"><select>${r.regions.map((g) => `<option>${esc(g.name)}</option>`).join('')}</select><input type="number" step="0.01" placeholder="$" aria-label="Region price"><button class="btn">Add</button></form>`]
    }))
    $$('[data-price]').forEach((f) => f.onsubmit = async (e) => { e.preventDefault(); await act(() => A({ action: 'set_price', lead_type: f.dataset.price, cents: Math.round(Number(f.querySelector('input').value) * 100) }), 'Price saved'); pricing() })
    $$('[data-override]').forEach((f) => f.onsubmit = async (e) => { e.preventDefault(); await act(() => A({ action: 'set_price', lead_type: f.dataset.override, region: f.querySelector('select').value, cents: Math.round(Number(f.querySelector('input').value) * 100) }), 'Override saved'); pricing() })
    $$('[data-rm]').forEach((b) => b.onclick = async () => { const [lt, region] = b.dataset.rm.split('|'); await act(() => A({ action: 'set_price', lead_type: lt, region, remove: true }), 'Removed'); pricing() })
    $$('[data-active]').forEach((c) => c.onchange = async () => { await act(() => A({ action: 'set_lead_type', slug: c.dataset.active, active: c.checked, parked: !c.checked }), 'Saved'); pricing() })
  }

  // ── areas ──
  async function areas() {
    const r = await A({ action: 'areas' })
    const opts = (list, key) => list.map((x) => `<option value="${esc(x[key])}">${esc(x.name)}</option>`).join('')
    $('#p-areas').innerHTML = `
      <div class="card"><h2>Campaigns</h2>${table(['Lead type', 'Region', 'Platform', 'Campaign id', 'Active buyers', 'Status', 'Auto-pause', ''], r.campaigns.map((c) => [esc(c.lead_types?.name), esc(c.regions?.name), esc(c.platform), esc(c.campaign_ref || ''), c.active_buyers,
        `<span class="badge ${c.status === 'active' ? 'ok' : 'warn'}">${esc(c.status)}</span><div class="small muted">${esc(c.paused_reason || '')}</div>`, c.auto_pause ? 'on' : 'off',
        `<button class="btn link" data-toggle="${esc(c.id)}">${c.status === 'active' ? 'Mark paused' : 'Mark active'}</button>`]))}
        <form class="inline-form" id="f-camp" style="margin-top:12px"><select name="lt">${opts(r.lead_types, 'slug')}</select><select name="rg">${r.regions.map((g) => `<option>${esc(g.name)}</option>`).join('')}</select><select name="pf"><option>meta</option><option>google</option><option>other</option></select><input name="ref" placeholder="Campaign id"><button class="btn">Add campaign</button></form>
        <p class="muted small" style="margin-top:8px">Auto-pause rules raise an alert and email when an area has no active buyers or its cost per lead goes above the lead price. Pausing in the ad platform is manual for now.</p></div>
      <div class="card" style="margin-top:16px"><h2>Ad spend</h2>
        <form class="inline-form" id="f-spend"><select name="lt">${opts(r.lead_types, 'slug')}</select><select name="rg">${r.regions.map((g) => `<option>${esc(g.name)}</option>`).join('')}</select><input type="date" name="d" required><input type="number" step="0.01" name="v" placeholder="$" required><button class="btn">Add</button></form>
        <form id="f-import" class="stack" style="margin-top:12px"><label>Import CSV (lead_type_slug,region,date,amount_dollars with a header row)</label><textarea name="csv" rows="3"></textarea><div><button class="btn">Import</button></div></form>
        ${table(['Date', 'Lead type', 'Region', 'Amount', 'Source'], r.spend.map((s) => [esc(s.spend_date), esc(r.lead_types.find((t) => t.id === s.lead_type_id)?.name || ''), esc(r.regions.find((g) => g.id === s.region_id)?.name || ''), money(s.amount_cents), esc(s.source)]))}</div>`
    const camps = Object.fromEntries(r.campaigns.map((c) => [c.id, c]))
    $$('[data-toggle]').forEach((b) => b.onclick = async () => { const c = camps[b.dataset.toggle]; await act(() => A({ action: 'save_campaign', id: c.id, lead_type: c.lead_types.slug, region: c.regions.name, platform: c.platform, campaign_ref: c.campaign_ref, auto_pause: c.auto_pause, status: c.status === 'active' ? 'paused' : 'active' }), 'Saved'); areas() })
    $('#f-camp').onsubmit = async (e) => { e.preventDefault(); const f = e.target; await act(() => A({ action: 'save_campaign', lead_type: f.lt.value, region: f.rg.value, platform: f.pf.value, campaign_ref: f.ref.value }), 'Campaign added'); areas() }
    $('#f-spend').onsubmit = async (e) => { e.preventDefault(); const f = e.target; await act(() => A({ action: 'add_spend', lead_type: f.lt.value, region: f.rg.value, date: f.d.value, cents: Math.round(Number(f.v.value) * 100) }), 'Spend added'); areas() }
    $('#f-import').onsubmit = async (e) => { e.preventDefault(); const x = await act(() => A({ action: 'import_spend', csv: e.target.csv.value })); flash(`Imported ${x.rows} rows`); areas() }
  }

  // ── payments ──
  async function payments() {
    const r = await A({ action: 'payments' })
    $('#p-payments').innerHTML = `
      <div class="card"><h2>Prepaid leads to refund</h2>${table(['Customer', 'Active since'], (r.prepaid_refunds || []).map((b) => [`<a href="#customer/${esc(b.id)}">${esc(b.business_name)}</a>`, esc(when(b.activated_at))]))}</div>
      <div class="card" style="margin-top:16px"><h2>Failed charges</h2>${table(['When', 'Customer', 'Amount', 'Status', 'Error'], (r.failed || []).map((c) => [esc(when(c.created_at)), `<a href="#customer/${esc(c.buyer_id)}">${esc(c.buyers?.business_name || '')}</a>`, money(c.amount_inc_gst_cents), esc(c.status), esc(c.error || '')]))}</div>
      <div class="card" style="margin-top:16px"><h2>Disputes</h2>${table(['When', 'Customer', 'Amount', 'Reason', 'Status'], (r.disputes || []).map((d) => [esc(when(d.created_at)), `<a href="#customer/${esc(d.buyer_id)}">${esc(d.buyers?.business_name || '')}</a>`, money(d.amount_cents), esc(d.reason || ''), esc(d.status)]))}</div>
      <div class="card" style="margin-top:16px"><h2>Refunds</h2>${table(['When', 'Customer', 'Charge', 'Refunded'], (r.refunds || []).map((c) => [esc(when(c.created_at)), esc(c.buyers?.business_name || ''), money(c.amount_inc_gst_cents), money(c.refunded_cents)]))}</div>`
  }

  // ── settings ──
  async function settings() {
    const r = await A({ action: 'settings' })
    const s = r.settings, b = r.brand
    const field = (k, label, type = 'number', step = '1') => `<label for="s-${k}">${label}</label><input id="s-${k}" name="${k}" type="${type}" step="${step}" value="${esc(s[k] ?? '')}">`
    $('#p-settings').innerHTML = `
      <form class="card stack" id="f-settings"><h2>Rules</h2>
        ${field('claim_window_hours', 'Claim window (hours)')}${field('stop_loss_multiplier', 'Stop-loss multiplier (× lead price)', 'number', '0.1')}${field('prepaid_refund_days', 'Flag prepaid lead for refund after (days)')}
        ${field('weekly_cap_min', 'Weekly cap minimum')}${field('weekly_cap_default', 'Weekly cap default')}${field('weekly_cap_max', 'Weekly cap maximum')}${field('dedupe_days', 'Duplicate window (days)')}
        ${field('app_base_url', 'App URL', 'url')}${field('functions_base_url', 'Functions URL (for scheduled jobs)', 'url')}
        <label><input type="checkbox" name="orders_paused"${s.orders_paused ? ' checked' : ''}> Pause new orders</label>
        <div><button class="btn primary">Save settings</button></div></form>
      <div class="card" style="margin-top:16px"><h2>Brand (read only)</h2>${kv([['Name', esc(b.name)], ['Supplier', `${esc(b.supplier.legalName)} · ABN ${esc(b.supplier.abn)}`], ['App', esc(b.domains.app)], ['Admin', esc(b.domains.admin)], ['Email from', `${esc(b.email.fromName)} &lt;${esc(b.email.fromAddress)}&gt;`], ['Support', esc(b.support.email)], ['Accent', `<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${esc(b.theme.accent)};vertical-align:middle"></span> ${esc(b.theme.accent)}`]])}
        <p class="muted small" style="margin-top:10px">Brand values change in the brand config file only.</p></div>`
    $('#f-settings').onsubmit = async (e) => {
      e.preventDefault()
      const f = e.target, patch = { action: 'update_settings', orders_paused: f.orders_paused.checked }
      for (const k of ['claim_window_hours', 'prepaid_refund_days', 'weekly_cap_min', 'weekly_cap_default', 'weekly_cap_max', 'dedupe_days']) patch[k] = Number(f[k].value)
      patch.stop_loss_multiplier = Number(f.stop_loss_multiplier.value)
      patch.app_base_url = f.app_base_url.value || null
      patch.functions_base_url = f.functions_base_url.value || null
      await act(() => A(patch), 'Settings saved')
    }
  }

  // ── audit ──
  async function auditLog() {
    const r = await A({ action: 'audit' })
    $('#p-audit').innerHTML = table(['When', 'Who', 'Action', 'Target', 'Change'], r.entries.map((a) => [esc(when(a.created_at)), esc(a.actor_kind) + `<div class="small muted">${esc((a.actor_id || '').slice(0, 8))}</div>`, esc(a.action), esc(`${a.target_table || ''} ${String(a.target_id || '').slice(0, 8)}`), `<span class="small">${esc(JSON.stringify({ before: a.before, after: a.after }).slice(0, 240))}</span>`]))
  }

  function route() {
    const h = location.hash.slice(1) || 'dashboard'
    const [name, arg] = h.split('/')
    const go = {
      dashboard, customers, claims, pricing, areas, payments, settings, audit: auditLog,
      customer: () => customer(arg), lead: () => lead(arg),
      'leads?unrouted': () => { page('leads'); return leads('unrouted') }, leads: () => leads(),
    }[name]
    if (go) Promise.resolve(go()).catch((e) => flash(e.message, 'err'))
  }

  let entered = false
  async function enter() {
    if (entered) return
    entered = true
    let me
    try {
      me = await call('me')
    } catch (e) {
      entered = false
      if (e.status === 401) return showSignIn()
      throw e
    }
    $('#signin').classList.add('hidden')
    $('#shell').classList.remove('hidden')
    $('#who-email').textContent = me.user.email || ''
    if (me.role !== 'admin') {
      $$('.side nav').forEach((n) => n.classList.add('hidden'))
      location.hash = 'denied'
      mountViews('denied')
      return
    }
    mountViews('dashboard')
    addEventListener('hashchange', route)
    route()
  }

  function showSignIn() {
    $('#shell').classList.add('hidden')
    $('#signin').classList.remove('hidden')
  }

  $('#signout').addEventListener('click', () => signOut(PATH))
  mountSignIn({ root: $('#signin'), redirectPath: PATH, onSignedIn: enter })
  client.auth.getSession().then(({ data }) => {
    if (data.session && !new URLSearchParams(location.search).has('reset')) enter()
    else showSignIn()
  })
  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' && !new URLSearchParams(location.search).has('reset')) enter()
  })
})()
