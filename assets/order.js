'use strict'
// Order page: lead types -> area -> weekly limit -> business details -> card.
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
  $$('[data-logo]').forEach((el) => {
    el.innerHTML = b.logoOnLight ? `<img src="/${esc(b.logoOnLight)}" alt="${esc(b.wordmark)}"><span class="product">${esc(b.productLabel || '')}</span>` : `<span class="wordmark">${esc(b.wordmark)}</span>`
  })
  const msg = (text, kind = 'err') => { const m = $('#msg'); m.className = `msg ${kind}`; m.textContent = text; m.classList.remove('hidden') }

  let loc = 'radius'
  const suburbs = []
  const authText = () => `I authorise ${b.wordmark} to charge this card for each lead delivered, up to my weekly cap of ${Number($('#cap').value) || 0} leads.`

  function payload(dry) {
    return {
      dry_run: dry,
      lead_types: $$('#types input:checked').map((i) => i.value),
      location_type: loc,
      service_areas: suburbs.map((s) => ({ label: s.label, lat: s.lat, lng: s.lng, radius_km: Number(s.km) })),
      postcode_list: $('#pc-list').value,
      region: loc === 'statewide' ? $('#state').value : $('#pc-city').value,
      weekly_cap: Number($('#cap').value),
      business: { name: $('#b-name').value, abn: $('#b-abn').value, contact_name: $('#b-contact').value, email: $('#b-email').value, phone: $('#b-phone').value },
      authorised: $('#authorise').checked,
      accept_terms: $('#terms').checked,
    }
  }

  let qt
  function requote() {
    $('#authorise-text').textContent = authText()
    clearTimeout(qt)
    qt = setTimeout(async () => {
      const p = payload(true)
      if (!p.lead_types.length || (loc === 'radius' && !suburbs.length) || (loc === 'postcodes' && !p.postcode_list.trim())) return
      const res = await fetch(fn('checkout'), { method: 'POST', headers, body: JSON.stringify(p) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { $('#quote').innerHTML = `<p class="muted">${esc(d.error || 'Couldn\'t price that yet.')}</p>`; return }
      const names = Object.fromEntries($$('#types input').map((i) => [i.value, i.dataset.name]))
      $('#quote').innerHTML = d.areas.map((a) => `<div class="kv"><span>${esc(a.label)}<div class="muted small">${a.postcode_count} postcodes</div></span><span>${a.prices.map((x) => `${esc(names[x.lead_type])}: <b>${money(x.price_ex_cents)}</b> + GST`).join('<br>')}</span></div>`).join('') +
        `<p style="margin-top:10px">Spending limit: <b>${esc(d.spending_limit_text)}</b></p><p class="muted small">Due today: your first lead, ${money(d.first_lead_ex_cents)} + GST.</p>`
    }, 350)
  }

  async function init() {
    const r = await fetch(fn('pricing'), { headers }).then((x) => x.json())
    if (r.orders_paused) msg(`New orders are paused at the moment. Contact ${b.supportEmail}.`)
    $('#types').innerHTML = r.categories.map((c) => `<p class="muted small" style="margin-top:6px">${esc(c.name)}</p>` +
      c.lead_types.map((t) => `<label><input type="checkbox" value="${esc(t.slug)}" data-name="${esc(t.name)}"> ${esc(t.name)}</label>`).join('')).join('')
    $('#pc-city').innerHTML = r.regions.map((x) => `<option>${esc(x.name)}</option>`).join('')
    $('#cap').min = r.weekly_cap.min
    $('#cap').max = r.weekly_cap.max
    $('#cap').value = r.weekly_cap.default
    $$('#types input').forEach((i) => i.addEventListener('change', requote))
    requote()
  }

  $$('[data-loc]').forEach((t) => t.addEventListener('click', () => {
    loc = t.dataset.loc
    $$('[data-loc]').forEach((x) => x.setAttribute('aria-selected', String(x === t)))
    $$('[data-locpane]').forEach((p) => p.classList.toggle('hidden', p.dataset.locpane !== loc))
    requote()
  }))
  ;['#cap', '#pc-list', '#pc-city', '#state'].forEach((s) => $(s).addEventListener('input', requote))

  function drawSuburbs() {
    $('#sub-list').innerHTML = suburbs.map((s, i) => `<div class="kv"><span>${esc(s.label)}</span><span class="row-actions">
      <select data-km="${i}" aria-label="Distance">${[50, 75, 100].map((k) => `<option${k == s.km ? ' selected' : ''}>${k}</option>`).join('')}</select> km
      <button class="btn link" type="button" data-rm="${i}">Remove</button></span></div>`).join('')
    $$('[data-km]').forEach((el) => el.onchange = () => { suburbs[el.dataset.km].km = el.value; requote() })
    $$('[data-rm]').forEach((el) => el.onclick = () => { suburbs.splice(Number(el.dataset.rm), 1); drawSuburbs(); requote() })
  }
  let st
  $('#sub-q').addEventListener('input', () => {
    clearTimeout(st)
    st = setTimeout(async () => {
      const q = $('#sub-q').value.trim()
      if (q.length < 2) { $('#sub-results').innerHTML = ''; return }
      const res = await fetch(fn('suburbs') + '?q=' + encodeURIComponent(q), { headers }).then((x) => x.json()).catch(() => [])
      $('#sub-results').innerHTML = (res || []).map((s, i) => `<button type="button" data-i="${i}">${esc(s.label)}</button>`).join('')
      $$('#sub-results button').forEach((bt) => bt.onclick = () => {
        if (suburbs.length >= 5) return msg('Up to five suburbs. Remove one first.')
        suburbs.push({ ...res[bt.dataset.i], km: 50 })
        $('#sub-q').value = ''
        $('#sub-results').innerHTML = ''
        drawSuburbs()
        requote()
      })
    }, 250)
  })

  $('#order').addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = $('#pay-btn')
    btn.disabled = true
    try {
      const res = await fetch(fn('checkout'), { method: 'POST', headers, body: JSON.stringify(payload(false)) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Something went wrong.')
      if (d.mock || !cfg.stripeKey) {
        msg('Test mode: no card form is shown and nothing is charged. The account is created when the test payment is confirmed.', 'ok')
        return
      }
      $('#order').classList.add('hidden')
      const stripe = window.Stripe(cfg.stripeKey)
      const checkout = await stripe.initEmbeddedCheckout({ clientSecret: d.client_secret })
      checkout.mount('#checkout')
    } catch (err) {
      msg(err.message)
    } finally {
      btn.disabled = false
    }
  })

  init().catch(() => msg('Couldn\'t load prices. Please refresh.'))
})()
