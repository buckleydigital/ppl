'use strict'
// Order page, one step at a time: lead type -> service area -> weekly limit -> details -> card.
// Prices always come from the server (checkout dry run); the browser only shows them.
;(function () {
  const cfg = window.APP_CONFIG
  const $ = (s) => document.querySelector(s)
  const $$ = (s) => [...document.querySelectorAll(s)]
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const money = (c) => '$' + (Number(c || 0) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fn = (name) => `${cfg.supabaseUrl}/functions/v1/${name}`
  const headers = { 'Content-Type': 'application/json', apikey: cfg.supabaseKey }
  const b = cfg.brand

  const msg = (text, kind = 'err') => { const m = $('#msg'); m.className = `msg ${kind}`; m.textContent = text; m.classList.remove('hidden') }
  const clearMsg = () => $('#msg').classList.add('hidden')

  // Simple line icons per lead type; anything unknown gets a generic house.
  const ICON = {
    solar_battery: '<rect x="3" y="4" width="18" height="11" rx="1.5"/><path d="M3 9.5h18M9 4v11M15 4v11M8 20h8M12 15v5"/>',
    batteries: '<rect x="3" y="7" width="16" height="11" rx="2"/><path d="M21 11v3M12 9l-3 4h4l-3 4"/>',
    heat_pumps: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="3.5"/><path d="M15 9h3M15 12h3M15 15h3"/>',
    ev_chargers: '<rect x="5" y="3" width="10" height="18" rx="2"/><path d="M15 8h2a2 2 0 0 1 2 2v5a2 2 0 0 0 4 0V9M10 8l-2 4h4l-2 4"/>',
    hvac: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><circle cx="12" cy="12" r="2"/>',
    roofing: '<path d="M2 12 12 4l10 8M5 10v10h14V10"/>',
    renovations: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
    decking_pergolas: '<path d="M3 8h18M5 8v12M19 8v12M3 4h18M9 8v12M15 8v12"/>',
    modular_homes: '<rect x="3" y="11" width="8" height="9"/><rect x="13" y="11" width="8" height="9"/><path d="M2 11l5-6h10l5 6"/>',
  }
  const DEFAULT_ICON = '<path d="M3 11 12 4l9 7v9H3z"/><path d="M9 20v-6h6v6"/>'
  const icon = (slug) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[slug] || DEFAULT_ICON}</svg>`

  // ── state ──
  let loc = 'radius'
  const suburbs = []
  let quote = null        // last good dry-run result
  let quoteErr = ''       // why the area can't be priced, if it can't
  let quoting = null      // in-flight promise
  let pricing = null
  const names = {}

  const capVal = () => Number($('#cap').value) || 0
  const authText = () => `I authorise ${b.wordmark} to charge my card for each lead delivered, up to my weekly limit of ${capVal()} leads.`

  function payload(dry) {
    return {
      dry_run: dry,
      lead_types: $$('#types input:checked').map((i) => i.value),
      location_type: loc,
      service_areas: suburbs.map((s) => ({ label: s.label, lat: s.lat, lng: s.lng, radius_km: Number(s.km) })),
      postcode_list: $('#pc-list').value,
      region: loc === 'statewide' ? $('#state').value : $('#pc-city').value,
      weekly_cap: capVal(),
      business: { name: $('#b-name').value.trim(), abn: $('#b-abn').value.trim(), contact_name: $('#b-contact').value.trim(), email: $('#b-email').value.trim(), phone: $('#b-phone').value.trim() },
      authorised: $('#authorise').checked,
      accept_terms: $('#terms').checked,
    }
  }

  // ── pricing (dry run) ──
  const areaReady = (p) => p.lead_types.length && !((loc === 'radius' && !suburbs.length) || (loc === 'postcodes' && !p.postcode_list.trim()))
  let qt
  function requote() {
    $('#authorise-text').textContent = authText()
    quote = null
    quoteErr = ''
    clearTimeout(qt)
    qt = null
    drawPrices()
    const p = payload(true)
    if (!areaReady(p)) return
    $('#area-price').hidden = false
    $('#area-price').innerHTML = '<span class="muted">Getting your price…</span>'
    qt = setTimeout(() => { qt = null; quoting = fetchQuote(p) }, 300)
  }
  async function fetchQuote(p) {
    try {
      const res = await fetch(fn('checkout'), { method: 'POST', headers, body: JSON.stringify(p) })
      const d = await res.json().catch(() => ({}))
      if (JSON.stringify(payload(true)) !== JSON.stringify(p)) return // superseded
      if (!res.ok) { quoteErr = d.error || 'We couldn\'t price that area yet.'; quote = null } else { quote = d; quoteErr = '' }
    } catch { quoteErr = 'We couldn\'t reach the server. Check your connection and try again.' }
    finally { quoting = null; drawPrices() }
  }

  function drawPrices() {
    const ap = $('#area-price'), cp = $('#cap-price')
    if (quoteErr) { ap.hidden = false; ap.innerHTML = `<span class="wz-bad">${esc(quoteErr)}</span>`; cp.innerHTML = ''; return }
    if (!quote) { if (!quoting && !qt) ap.hidden = true; cp.innerHTML = '<span class="muted">Set your area to see your price.</span>'; return }
    ap.hidden = false
    ap.innerHTML = quote.areas.map((a) => `<div class="wz-price-row"><div><b>${esc(a.label)}</b><div class="muted small">${a.postcode_count} postcodes</div></div>
      <div class="wz-price-list">${a.prices.map((x) => `<div>${esc(names[x.lead_type] || x.lead_type)} <b>${money(x.price_ex_cents)}</b><span class="muted small"> + GST</span></div>`).join('')}</div></div>`).join('')
    cp.innerHTML = `<div class="wz-limit">${esc(quote.spending_limit_text)}</div><p class="muted small">That's the most you can be charged in a week. No surprise bills.</p>`
  }

  // ── summary (last step) ──
  function drawSummary() {
    const types = $$('#types input:checked').map((i) => esc(i.dataset.name)).join(', ')
    const area = loc === 'radius' ? suburbs.map((s) => `${esc(s.label)} (${s.km} km)`).join(', ')
      : loc === 'postcodes' ? `Postcode list near ${esc($('#pc-city').value)}` : `All of ${esc($('#state').value)}`
    $('#summary').innerHTML = `<div class="wz-sum-row"><span>Lead type</span><span>${types}</span></div>
      <div class="wz-sum-row"><span>Service area</span><span>${area}</span></div>
      <div class="wz-sum-row"><span>Weekly limit</span><span>${quote ? esc(quote.spending_limit_text) : `${capVal()} leads`}</span></div>
      ${quote ? `<div class="wz-sum-row wz-sum-due"><span>Due today</span><span><b>${money(quote.first_lead_ex_cents)}</b> + GST <span class="muted small">(your first lead, prepaid)</span></span></div>` : ''}`
  }

  // ── wizard ──
  const steps = $$('.wz-step')
  let at = 0
  function show(i, scroll = true) {
    at = i
    steps.forEach((s, j) => { s.hidden = j !== i })
    $('#wz-label').textContent = `Step ${i + 1} of ${steps.length}`
    $('#wz-title').textContent = steps[i].dataset.title
    $('#wz-fill').style.width = `${((i + 1) / steps.length) * 100}%`
    $('#wz-back').hidden = i === 0
    const last = i === steps.length - 1
    $('#wz-next').hidden = last
    $('#pay-btn').hidden = !last
    $('#wz-err').textContent = ''
    clearMsg()
    if (steps[i].dataset.step === 'details') drawSummary()
    if (scroll) $('#wz').scrollIntoView({ behavior: 'smooth', block: 'start' })
    const focusable = steps[i].querySelector('input:not([type=checkbox]):not([type=range]),select,textarea')
    if (focusable && scroll && window.matchMedia('(min-width: 700px)').matches) focusable.focus({ preventScroll: true })
  }

  async function check(step) {
    const p = payload(true)
    if (step === 'type' && !p.lead_types.length) return 'Pick at least one lead type to continue.'
    if (step === 'area') {
      if (loc === 'radius' && !suburbs.length) return 'Add at least one suburb. Pick it from the suggestions as you type.'
      if (loc === 'postcodes' && !p.postcode_list.trim()) return 'Add your postcodes to continue.'
      if (qt || quoting) { await new Promise((r) => setTimeout(r, 350)); if (quoting) await quoting }
      if (quoteErr) return quoteErr
      if (!quote) return 'Just a moment, getting your price…'
    }
    if (step === 'cap') {
      const min = Number($('#cap').min), max = Number($('#cap').max)
      if (capVal() < min || capVal() > max) return `Choose between ${min} and ${max} leads a week.`
    }
    if (step === 'details') {
      const bz = p.business
      if (!bz.name) return 'Enter your business name.'
      if (bz.abn.replace(/\D/g, '').length !== 11) return 'Enter your 11-digit ABN.'
      if (!bz.contact_name) return 'Enter your name.'
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bz.email)) return 'Enter a valid email address.'
      if (bz.phone.replace(/\D/g, '').length < 9) return 'Enter your mobile number.'
      if (!p.authorised) return 'Tick the box to authorise charges for delivered leads.'
      if (!p.accept_terms) return 'Tick the box to agree to the Terms and Privacy Policy.'
    }
    return ''
  }

  $('#wz-next').addEventListener('click', async () => {
    const btn = $('#wz-next')
    btn.disabled = true
    const err = await check(steps[at].dataset.step)
    btn.disabled = false
    if (err) { $('#wz-err').textContent = err; return }
    show(Math.min(at + 1, steps.length - 1))
  })
  $('#wz-back').addEventListener('click', () => show(Math.max(at - 1, 0)))
  // Enter in a text field moves forward instead of submitting early.
  $('#order').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.id !== 'sub-q' && at < steps.length - 1) { e.preventDefault(); $('#wz-next').click() }
  })

  // ── step 1: lead types ──
  function fromPrice(slug) {
    const rows = (pricing.prices || []).filter((p) => p.lead_type === slug && !p.sold_out)
    return rows.length ? Math.min(...rows.map((r) => r.price_ex_cents)) : null
  }
  function drawTypes() {
    $('#types').innerHTML = pricing.categories.filter((c) => c.lead_types.length).map((c) => `<p class="wz-cat">${esc(c.name)}</p><div class="wz-grid">` +
      c.lead_types.map((t) => {
        names[t.slug] = t.name
        const from = fromPrice(t.slug)
        return `<label class="wz-tile"><input type="checkbox" value="${esc(t.slug)}" data-name="${esc(t.name)}">
          <span class="wz-ico">${icon(t.slug)}</span>
          <span class="wz-tname">${esc(t.name)}<span class="wz-from">${from ? `From ${money(from)} + GST` : '&nbsp;'}</span></span>
          <span class="wz-tick" aria-hidden="true"><svg viewBox="0 0 12 10"><path d="M1 5l3.5 3.5L11 1"/></svg></span></label>`
      }).join('') + '</div>').join('')
    $$('#types input').forEach((i) => i.addEventListener('change', () => { $('#wz-err').textContent = ''; requote() }))
  }

  // ── step 2: area ──
  $$('[data-loc]').forEach((t) => t.addEventListener('click', () => {
    loc = t.dataset.loc
    $$('[data-loc]').forEach((x) => x.setAttribute('aria-selected', String(x === t)))
    $$('[data-locpane]').forEach((p) => { p.hidden = p.dataset.locpane !== loc })
    $('#wz-err').textContent = ''
    requote()
  }))
  ;['#pc-list', '#pc-city', '#state'].forEach((s) => $(s).addEventListener('input', requote))

  function drawSuburbs() {
    $('#sub-list').innerHTML = suburbs.map((s, i) => `<div class="wz-area"><div class="wz-area-name">${esc(s.label)}</div>
      <label class="wz-area-km">within <select data-km="${i}" aria-label="Distance from ${esc(s.label)}">${[50, 75, 100].map((k) => `<option value="${k}"${k == s.km ? ' selected' : ''}>${k} km</option>`).join('')}</select></label>
      <button class="wz-x" type="button" data-rm="${i}" aria-label="Remove ${esc(s.label)}">&times;</button></div>`).join('')
    $$('[data-km]').forEach((el) => el.onchange = () => { suburbs[el.dataset.km].km = Number(el.value); requote() })
    $$('[data-rm]').forEach((el) => el.onclick = () => { suburbs.splice(Number(el.dataset.rm), 1); drawSuburbs(); requote() })
    $('#sub-q').disabled = suburbs.length >= 5
    $('#sub-q').placeholder = suburbs.length >= 5 ? 'Five suburbs added' : suburbs.length ? 'Add another suburb' : 'Start typing a suburb or postcode'
  }
  let st
  const closeSuggest = () => { $('#sub-results').innerHTML = ''; $('#sub-q').setAttribute('aria-expanded', 'false') }
  $('#sub-q').addEventListener('input', () => {
    clearTimeout(st)
    st = setTimeout(async () => {
      const q = $('#sub-q').value.trim()
      if (q.length < 2) return closeSuggest()
      const res = await fetch(fn('suburbs') + '?q=' + encodeURIComponent(q), { headers }).then((x) => x.json()).catch(() => [])
      const list = Array.isArray(res) ? res : []
      $('#sub-results').innerHTML = list.length ? list.map((s, i) => `<button type="button" role="option" data-i="${i}">${esc(s.label)}</button>`).join('') : '<div class="wz-none">No matching suburb</div>'
      $('#sub-q').setAttribute('aria-expanded', 'true')
      $$('#sub-results button').forEach((bt) => bt.onclick = () => {
        const s = list[bt.dataset.i]
        if (!suburbs.some((x) => x.label === s.label)) suburbs.push({ ...s, km: 50 })
        $('#sub-q').value = ''
        closeSuggest()
        $('#wz-err').textContent = ''
        drawSuburbs()
        requote()
      })
    }, 220)
  })
  $('#sub-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const first = $('#sub-results button'); if (first) first.click() }
    if (e.key === 'Escape') closeSuggest()
  })
  document.addEventListener('click', (e) => { if (!e.target.closest('.wz-search')) closeSuggest() })

  // ── step 3: weekly limit ──
  function drawCap() {
    const el = $('#cap')
    $('#cap-num').textContent = el.value
    el.style.setProperty('--fill', `${((el.value - el.min) / (el.max - el.min)) * 100}%`)
  }
  $('#cap').addEventListener('input', () => { drawCap(); requote() })

  // ── submit ──
  $('#order').addEventListener('submit', async (e) => {
    e.preventDefault()
    const err = await check('details')
    $('#wz-err').textContent = err
    if (err) return
    const btn = $('#pay-btn')
    btn.disabled = true
    btn.textContent = 'One moment…'
    try {
      const res = await fetch(fn('checkout'), { method: 'POST', headers, body: JSON.stringify(payload(false)) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Something went wrong. Please try again.')
      if (d.mock || !cfg.stripeKey) {
        msg('Test mode: card payments aren\'t switched on yet, so nothing was charged.', 'ok')
        $('#wz').scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      $('#order').hidden = true
      $('.wz-progress').hidden = true
      $('#checkout').hidden = false
      const stripe = window.Stripe(cfg.stripeKey)
      const checkout = await stripe.initEmbeddedCheckout({ clientSecret: d.client_secret })
      checkout.mount('#checkout-mount')
      $('#wz').scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (ex) {
      $('#wz-err').textContent = ex.message
    } finally {
      btn.disabled = false
      btn.textContent = 'Continue to payment'
    }
  })

  // ── start ──
  async function init() {
    pricing = await fetch(fn('pricing'), { headers }).then((x) => { if (!x.ok) throw new Error(); return x.json() })
    if (pricing.orders_paused) msg(`New orders are paused at the moment. Contact ${b.supportEmail}.`)
    drawTypes()
    $('#pc-city').innerHTML = pricing.regions.map((x) => `<option>${esc(x.name)}</option>`).join('')
    const cap = $('#cap')
    cap.min = pricing.weekly_cap.min ?? 5
    cap.max = pricing.weekly_cap.max ?? 50
    cap.value = pricing.weekly_cap.default ?? 10
    $('#cap-min').textContent = cap.min
    $('#cap-max').textContent = cap.max
    drawCap()
    requote()
  }
  drawSuburbs()
  show(0, false)
  init().catch(() => { $('#types').innerHTML = ''; msg('Couldn\'t load lead types. Please refresh the page.') })
})()
