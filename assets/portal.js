'use strict'
// Customer portal: leads inbox, billing, settings, profile, push alerts.
;(function () {
  const { cfg, client, call, $, $$, esc, brandLogo, mountSignIn, mountViews, signOut } = window.App
  const PATH = '/app/'
  $$('[data-logo]').forEach(brandLogo)
  const support = $('#support-link')
  support.textContent = cfg.brand.supportEmail || ''
  support.href = 'mailto:' + (cfg.brand.supportEmail || '')

  const money = (c) => '$' + (Number(c || 0) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const when = (t) => t ? new Date(t).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''
  const day = (t) => t ? new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  const OUTCOME = { new: 'New', contacted: 'Contacted', quoted: 'Quoted', won: 'Won', lost: 'Lost' }
  const STATUS = {
    pending: ['Setting up', 'warn', 'Your account is being set up.'],
    active: ['Active', 'ok', 'Leads are being delivered.'],
    paused: ['Paused', 'warn', 'Lead delivery is paused.'],
    payment_failed: ['Card needs updating', 'warn', 'Your last charge failed, so delivery is paused. Update your card to resume.'],
    disputed: ['On hold', 'warn', 'Your account is on hold. Please contact us.'],
    dormant: ['Not active yet', 'warn', 'Your account hasn\'t been switched on yet.'],
  }
  const CLAIM_REASONS = { invalid_number: 'Phone number invalid or disconnected', invalid_email: 'Email address can\'t receive mail', outside_area: 'Postcode outside my agreed area', wrong_service: 'Not the service I selected', duplicate: 'Duplicate (sent to me in the last 30 days)', fake: 'Not a real person' }

  let me = null
  function flash(text, kind = 'ok') {
    const f = $('#flash')
    f.className = `msg ${kind}`
    f.textContent = text
    f.classList.remove('hidden')
    clearTimeout(flash.t)
    flash.t = setTimeout(() => f.classList.add('hidden'), 6000)
    scrollTo({ top: 0, behavior: 'smooth' })
  }
  async function act(fn, body, ok) {
    try {
      const r = await call(fn, body)
      if (ok) flash(ok)
      return r
    } catch (e) {
      flash(e.message, 'err')
      throw e
    }
  }

  // ── leads ──
  let page = 0
  async function loadLeads(reset = true) {
    if (reset) page = 0
    const r = await call('portal', { action: 'leads', page, q: $('#f-q').value, outcome: $('#f-outcome').value, lead_type: $('#f-type').value })
    const html = r.leads.map((l) => `
      <a class="lead-row" href="#lead/${esc(l.id)}">
        <div><b>${esc([l.first_name, l.last_name].filter(Boolean).join(' ') || 'Lead')}</b>
          <div class="meta">${esc(l.lead_type || '')} · ${esc([l.suburb, l.postcode].filter(Boolean).join(' '))} · ${esc(when(l.delivered_at))}</div></div>
        <span class="badge ${l.outcome === 'won' ? 'ok' : ''}">${esc(OUTCOME[l.outcome] || l.outcome)}</span>
      </a>`).join('')
    $('#lead-list').innerHTML = reset ? (html || '<div class="empty">No leads yet. They\'ll appear here the moment they\'re delivered.</div>') : $('#lead-list').innerHTML + html
    $('#more').hidden = (page + 1) * 50 >= r.total
  }
  let qTimer
  $('#f-q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => loadLeads(), 300) })
  $('#f-outcome').addEventListener('change', () => loadLeads())
  $('#f-type').addEventListener('change', () => loadLeads())
  $('#more').addEventListener('click', () => { page++; loadLeads(false) })

  async function showLead(id) {
    $$('[data-page]').forEach((p) => p.classList.toggle('hidden', p.dataset.page !== 'lead'))
    const box = $('#lead-detail')
    box.innerHTML = '<p class="muted">Loading...</p>'
    let r
    try { r = await call('portal', { action: 'lead', id }) } catch (e) { box.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return }
    const l = r.lead, d = l.details || {}
    const name = [l.first_name, l.last_name].filter(Boolean).join(' ')
    const rows = [['Phone', l.phone_e164], ['Email', l.email], ['Location', [l.suburb, l.state, l.postcode].filter(Boolean).join(' ')], ['Lead type', l.lead_type],
      ['Homeowner', d.is_homeowner == null ? '' : d.is_homeowner ? 'Yes' : 'No'], ['Quarterly bill', d.avg_quarterly_bill], ['Interested in', d.interested_in], ['Timeline', d.purchase_timeline],
      ...Object.entries(d.custom_fields || {}).filter(([, v]) => v != null && typeof v !== 'object').map(([k, v]) => [k.replace(/_/g, ' '), String(v)]),
      ['Delivered', when(l.delivered_at)], ['Price', r.charge ? `${money(r.charge.price_ex_cents)} + GST${r.charge.credit_applied_cents ? ` (${money(r.charge.credit_applied_cents)} from credit)` : ''}` : '']]
      .filter(([, v]) => v)
    const claim = r.claim
      ? `<p>Credit claim: <span class="badge ${claim.status.includes('approved') ? 'ok' : ''}">${esc(claim.status.replace('_', ' '))}</span> ${esc(CLAIM_REASONS[claim.reason] || '')}${claim.decision_reason ? ` · ${esc(claim.decision_reason)}` : ''}</p>`
      : r.can_claim
        ? `<details><summary class="btn">Report a bad lead</summary><form id="claim-form" class="stack" style="margin-top:10px">
            <label for="c-reason">Reason</label><select id="c-reason">${Object.entries(CLAIM_REASONS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
            <label for="c-notes">Details (optional)</label><textarea id="c-notes" rows="2"></textarea>
            <p class="muted small">Claims close ${esc(when(r.claim_window_closes_at))}. Not covered: the homeowner not answering, deciding not to go ahead, or getting other quotes. <a href="/what-counts/" target="_blank">What counts as a lead</a></p>
            <button class="btn primary" type="submit">Submit claim</button></form></details>`
        : '<p class="muted small">The claim window for this lead has closed.</p>'
    box.innerHTML = `
      <div class="page-head"><div><h1>${esc(name || 'Lead')}</h1><p class="muted">${esc(l.lead_type || '')} · ${esc(l.suburb || l.postcode)}</p></div>
        <div class="row-actions"><a class="btn primary" href="tel:${esc(l.phone_e164)}">Call</a><a class="btn" href="sms:${esc(l.phone_e164)}">Text</a>${l.email ? `<a class="btn" href="mailto:${esc(l.email)}">Email</a>` : ''}</div></div>
      <div class="card"><label for="outcome">Outcome</label><select id="outcome" style="max-width:240px">${Object.entries(OUTCOME).map(([k, v]) => `<option value="${k}"${k === l.outcome ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="card" style="margin-top:16px">${rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span>${k === 'Phone' ? `<a href="tel:${esc(v)}">${esc(v)}</a>` : esc(v)}</span></div>`).join('')}</div>
      <div class="card" style="margin-top:16px"><h2>Consent</h2><p>${esc(r.consent?.consent_text || 'No consent text came with this lead.')}</p><p class="muted small">Captured ${esc(when(r.consent?.captured_at))}</p></div>
      ${r.sms.length ? `<div class="card" style="margin-top:16px"><h2>Texts</h2>${r.sms.map((m) => `<div class="bubble ${m.direction === 'inbound' ? 'in' : 'out'}">${esc(m.body)}<div class="muted small">${esc(when(m.created_at))}${m.is_ai ? ' · automatic' : ''}</div></div>`).join('')}</div>` : ''}
      <div class="card" style="margin-top:16px">${claim}</div>`
    $('#outcome').addEventListener('change', (e) => act('portal', { action: 'set_outcome', id: l.id, outcome: e.target.value }, 'Saved'))
    const cf = $('#claim-form')
    if (cf) cf.addEventListener('submit', async (e) => {
      e.preventDefault()
      const res = await act('claims', { action: 'submit', lead_id: l.id, reason: $('#c-reason').value, notes: $('#c-notes').value })
      flash(res.status === 'auto_approved' ? 'Approved: the credit has been added to your account.' : 'Thanks. We\'ll review your claim and let you know.')
      showLead(l.id)
    })
  }

  // ── billing ──
  async function loadBilling() {
    const r = await call('billing', { action: 'status' })
    const [label, kind] = STATUS[r.status] || [r.status, '']
    $('#bill-stats').innerHTML = [
      ['Delivery', `<span class="badge ${kind}">${esc(label)}</span>`],
      ['Card', r.card ? `${esc((r.card.brand || '').toUpperCase())} •••• ${esc(r.card.last4)}` : 'No card saved'],
      ['Credit', money(r.credit_cents)],
      ['This week', `${r.this_week} of ${r.weekly_cap} leads`],
      ['Spending limit', esc(r.spending_limit_text || '')],
      ['First lead', { none: 'Not paid', held: 'Prepaid, waiting', used: 'Used', refund_flagged: 'Refund pending', refunded: 'Refunded' }[r.prepaid_status] || ''],
    ].map(([k, v]) => `<div class="card stat"><span class="muted small">${esc(k)}</span><b style="font-size:18px">${v}</b></div>`).join('') +
      `<div class="card"><button class="btn primary block" type="button" id="card-btn">Update card</button></div>`
    $('#card-btn').addEventListener('click', async () => { const u = await act('billing', { action: 'card_update' }); if (u.url) location.href = u.url })
    $('#cap-input').value = r.weekly_cap
    $('#cap-input').min = r.cap_limits.min
    $('#cap-input').max = r.cap_limits.max
    $('#cap-text').textContent = r.spending_limit_text || ''
    $('#charges').innerHTML = r.charges.length
      ? `<div class="table-wrap"><table class="list"><thead><tr><th>Date</th><th>What</th><th>Charged</th><th>Status</th></tr></thead><tbody>${r.charges.map((c) => `
        <tr><td>${esc(day(c.created_at))}</td><td>${esc(c.description || c.kind)}${c.credit_applied_cents ? `<div class="muted small">${money(c.credit_applied_cents)} from credit</div>` : ''}</td>
        <td>${money(c.amount_inc_gst_cents)}</td><td>${esc(c.status)}${c.error ? `<div class="muted small">${esc(c.error)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">No charges yet.</p>'
    const inv = await call('invoices', { action: 'list' }).catch(() => ({ invoices: [] }))
    $('#invoices').innerHTML = inv.invoices.length
      ? `<div class="table-wrap"><table class="list"><thead><tr><th>Invoice</th><th>Period</th><th>Total</th><th></th></tr></thead><tbody>${inv.invoices.map((i) => `
        <tr><td>${esc(i.number)}</td><td>${esc(day(i.period_start))} to ${esc(day(i.period_end))}</td><td>${money(i.total_cents)}</td>
        <td><button class="btn link" type="button" data-inv="${esc(i.id)}">PDF</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">Your first weekly invoice appears after your first week of leads.</p>'
    $$('[data-inv]').forEach((b) => b.addEventListener('click', async () => {
      const r2 = await act('invoices', { action: 'pdf', id: b.dataset.inv })
      if (r2.url) window.open(r2.url, '_blank', 'noopener')
    }))
    // pause / resume
    const actions = $('#delivery-actions')
    actions.innerHTML = r.status === 'active' ? '<button class="btn" type="button" id="pause">Pause delivery</button>'
      : r.status === 'paused' && r.paused_reason === 'customer' ? '<button class="btn primary" type="button" id="resume">Resume delivery</button>' : ''
    const p = $('#pause'), rs = $('#resume')
    if (p) p.onclick = async () => { await act('billing', { action: 'pause' }, 'Delivery paused'); refreshMe() }
    if (rs) rs.onclick = async () => { await act('billing', { action: 'resume' }, 'Delivery resumed'); refreshMe() }
  }
  $('#cap-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    await act('billing', { action: 'set_cap', weekly_cap: Number($('#cap-input').value) }, 'Weekly limit saved')
    loadBilling()
  })

  // ── settings ──
  let selectedSuburb = null
  async function loadSettings() {
    const s = await call('portal', { action: 'settings' })
    $('#types').innerHTML = s.lead_types.map((t) => `<label><input type="checkbox" value="${esc(t.slug)}"${t.selected ? ' checked' : ''}> ${esc(t.name)} <span class="muted small">${esc(t.category || '')}</span></label>`).join('')
    $('#f-type').innerHTML = '<option value="">All lead types</option>' + s.lead_types.filter((t) => t.selected).map((t) => `<option value="${esc(t.slug)}">${esc(t.name)}</option>`).join('')
    $('#areas').innerHTML = s.areas.map((a) => `
      <div class="kv"><span>${esc(a.label)}<div class="muted small">${a.postcode_count} postcodes · priced at ${esc(a.region || '')}</div></span>
      <span class="row-actions"><span class="badge ${a.status === 'active' ? 'ok' : 'warn'}">${esc(a.status)}</span>
        <button class="btn link" type="button" data-area-toggle="${esc(a.id)}" data-to="${a.status === 'active' ? 'paused' : 'active'}">${a.status === 'active' ? 'Pause' : 'Resume'}</button>
        <button class="btn link" type="button" data-area-remove="${esc(a.id)}">Remove</button></span></div>`).join('') || '<p class="muted">No areas yet.</p>'
    $$('[data-area-toggle]').forEach((b) => b.onclick = async () => { await act('portal', { action: 'set_area_status', id: b.dataset.areaToggle, status: b.dataset.to }, 'Area updated'); loadSettings() })
    $$('[data-area-remove]').forEach((b) => b.onclick = async () => { if (!confirm('Remove this area?')) return; await act('portal', { action: 'remove_area', id: b.dataset.areaRemove }, 'Area removed'); loadSettings() })
    const f = $('#notify-form')
    f.notify_email.checked = !!s.notifications.email
    f.notify_sms.checked = !!s.notifications.sms
    f.notify_push.checked = !!s.notifications.push
    f.ai_followup_enabled.checked = !!s.ai_followup_enabled
    $('#wh-url').value = s.webhook.url || ''
    $('#wh-mode').value = s.webhook.auth_mode || 'none'
    $('#wh-header').value = s.webhook.auth_header || ''
    $('#wh-auth').classList.toggle('hidden', $('#wh-mode').value === 'none')
    $('#wh-header').closest('div').querySelector('label').classList.toggle('hidden', $('#wh-mode').value !== 'header')
    $('#wh-header').classList.toggle('hidden', $('#wh-mode').value !== 'header')
  }
  $('#types-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    await act('portal', { action: 'update_settings', lead_types: $$('#types input:checked').map((i) => i.value) }, 'Lead types saved')
    loadSettings()
  })
  $('#notify-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const f = e.target
    if (f.notify_push.checked) await enablePush().catch((err) => flash(err.message, 'err'))
    await act('portal', { action: 'update_settings', notify_email: f.notify_email.checked, notify_sms: f.notify_sms.checked, notify_push: f.notify_push.checked, ai_followup_enabled: f.ai_followup_enabled.checked }, 'Notifications saved')
  })
  $('#wh-mode').addEventListener('change', () => {
    const m = $('#wh-mode').value
    $('#wh-auth').classList.toggle('hidden', m === 'none')
    $('#wh-header').classList.toggle('hidden', m !== 'header')
    $('#wh-header').closest('div').querySelector('label').classList.toggle('hidden', m !== 'header')
  })
  $('#webhook-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    await act('portal', { action: 'update_settings', crm_webhook_url: $('#wh-url').value, webhook_auth_mode: $('#wh-mode').value, webhook_auth_header: $('#wh-header').value, webhook_secret: $('#wh-secret').value }, 'Webhook saved')
    $('#wh-secret').value = ''
  })
  $('#wh-test').addEventListener('click', async () => {
    const r = await act('portal', { action: 'test_webhook' })
    flash(r.ok ? `Test lead sent (HTTP ${r.status}).` : `Your webhook didn't accept it: ${r.error || 'HTTP ' + r.status}`, r.ok ? 'ok' : 'err')
  })
  // add area
  let areaType = 'radius'
  $$('[data-areatab]').forEach((t) => t.addEventListener('click', () => {
    areaType = t.dataset.areatab
    $$('[data-areatab]').forEach((x) => x.setAttribute('aria-selected', String(x === t)))
    $$('[data-areapane]').forEach((p) => p.classList.toggle('hidden', p.dataset.areapane !== areaType))
  }))
  let subTimer
  $('#sub-q').addEventListener('input', () => {
    selectedSuburb = null
    clearTimeout(subTimer)
    subTimer = setTimeout(async () => {
      const q = $('#sub-q').value.trim()
      if (q.length < 2) { $('#sub-results').innerHTML = ''; return }
      const res = await fetch(`${cfg.supabaseUrl}/functions/v1/suburbs?q=${encodeURIComponent(q)}`, { headers: { apikey: cfg.supabaseKey } }).then((x) => x.json()).catch(() => [])
      $('#sub-results').innerHTML = (res || []).map((s, i) => `<button type="button" data-i="${i}">${esc(s.label)}</button>`).join('')
      $$('#sub-results button').forEach((b) => b.onclick = () => { selectedSuburb = res[b.dataset.i]; $('#sub-q').value = selectedSuburb.label; $('#sub-results').innerHTML = '' })
    }, 250)
  })
  $('#area-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    if (areaType === 'radius') {
      if (!selectedSuburb) return flash('Pick a suburb from the list', 'err')
      await act('portal', { action: 'add_area', location_type: 'radius', service_areas: [{ label: selectedSuburb.label, lat: selectedSuburb.lat, lng: selectedSuburb.lng, radius_km: Number($('#sub-km').value) }] }, 'Area added')
    } else {
      await act('portal', { action: 'add_area', location_type: 'postcodes', postcode_list: $('#pc-list').value }, 'Area added')
    }
    e.target.closest('details').open = false
    loadSettings()
  })

  // ── push ──
  async function enablePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('This browser doesn\'t support push notifications.')
    if (!cfg.vapidPublicKey) throw new Error('Push notifications aren\'t set up yet.')
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') throw new Error('Notifications are blocked for this site.')
    const reg = await navigator.serviceWorker.ready
    const key = Uint8Array.from(atob(cfg.vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    await call('portal', { action: 'push_subscribe', subscription: sub.toJSON() })
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {})

  // ── profile ──
  function fillProfile(b) {
    const f = $('#profile-form')
    f.business_name.value = b.business_name || ''
    f.legal_name.value = b.legal_name || ''
    f.abn.value = b.abn ? b.abn.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4') : ''
    f.contact_name.value = b.contact_name || ''
    f.phone.value = b.phone || ''
    $('#p-email').value = b.email || ''
  }
  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const f = e.target
    const r = await act('portal', { action: 'update_profile', business_name: f.business_name.value, legal_name: f.legal_name.value, abn: f.abn.value, contact_name: f.contact_name.value, phone: f.phone.value })
    flash(r.business_name_pending ? 'Saved. Your new business name will apply once we\'ve checked it.' : 'Profile saved')
    refreshMe()
  })

  // ── routing between views ──
  function route() {
    const h = location.hash.slice(1)
    if (h.startsWith('lead/')) return showLead(h.slice(5))
    if (h === 'billing') loadBilling().catch(() => {})
    if (h === 'settings') loadSettings().catch(() => {})
    if (h === 'leads' || !h) loadLeads().catch(() => {})
  }

  async function refreshMe() {
    me = await call('me')
    const b = me.buyer
    if (!b) return
    const [label, kind, line] = STATUS[b.status] || [b.status, '', '']
    $('#status-line').innerHTML = `<span class="badge ${kind}">${esc(label)}</span> ${esc(line)}`
    fillProfile(b)
    loadBilling().catch(() => {})
  }

  let entered = false
  async function enter() {
    if (entered) return
    entered = true
    try {
      me = await call('me')
    } catch (e) {
      entered = false
      if (e.status === 401) return showSignIn()
      $('#signin').classList.add('hidden')
      $('#shell').classList.remove('hidden')
      flash(e.message, 'err')
      return
    }
    $('#signin').classList.add('hidden')
    $('#shell').classList.remove('hidden')
    $('#who-email').textContent = me.user.email || ''
    $('#to-admin').classList.toggle('hidden', me.role !== 'admin')
    if (!me.buyer) {
      $$('.side nav').forEach((n) => n.classList.add('hidden'))
      location.hash = 'no-account'
      mountViews('no-account')
      return
    }
    if (new URLSearchParams(location.search).has('welcome')) flash('You\'re all set. Your first lead is prepaid and leads will arrive here.')
    await refreshMe()
    mountViews('leads')
    loadSettings().catch(() => {})
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
