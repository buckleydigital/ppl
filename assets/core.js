'use strict'
// Shared by both portals: config, Supabase client, sign-in, function calls.
// window.APP_CONFIG comes from /config.js, written by the build from env vars
// and the brand config. Only public values live there.
;(function () {
  const cfg = window.APP_CONFIG
  if (!cfg || !cfg.supabaseUrl || !cfg.supabaseKey) {
    document.body.innerHTML = '<p style="padding:24px">This site is not configured yet.</p>'
    throw new Error('APP_CONFIG missing')
  }
  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })

  const $ = (s, root = document) => root.querySelector(s)
  const $$ = (s, root = document) => [...root.querySelectorAll(s)]
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  async function token() {
    const { data } = await client.auth.getSession()
    return data.session?.access_token || null
  }

  // Calls an edge function as the signed-in user.
  async function call(fn, body = {}, { method = 'POST' } = {}) {
    const t = await token()
    const res = await fetch(`${cfg.supabaseUrl}/functions/v1/${fn}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.supabaseKey,
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`)
      err.status = res.status
      throw err
    }
    return data
  }

  function brandLogo(el) {
    const b = cfg.brand
    el.innerHTML = b.logoOnLight
      ? `<img src="/${esc(b.logoOnLight)}" alt="${esc(b.wordmark)}"><span class="product">${esc(b.productLabel || '')}</span>`
      : `<span class="wordmark">${esc(b.wordmark)}</span><span class="product">${esc(b.productLabel || '')}</span>`
  }

  function showMsg(el, text, kind = 'err') {
    el.className = `msg ${kind}`
    el.textContent = text
    el.classList.remove('hidden')
  }

  // Wires the sign-in card: password, magic link, forgotten password, new password.
  function mountSignIn({ root, redirectPath, onSignedIn }) {
    const msg = $('.msg', root)
    const tabs = $$('.tabs button', root)
    const forms = { password: $('#form-password', root), link: $('#form-link', root) }
    tabs.forEach((t) => t.addEventListener('click', () => {
      tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)))
      Object.entries(forms).forEach(([k, f]) => f.classList.toggle('hidden', k !== t.dataset.tab))
      msg.classList.add('hidden')
    }))
    const redirectTo = location.origin + redirectPath

    forms.password.addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = $('button[type=submit]', forms.password)
      btn.disabled = true
      const { error } = await client.auth.signInWithPassword({
        email: forms.password.email.value.trim(),
        password: forms.password.password.value,
      })
      btn.disabled = false
      if (error) return showMsg(msg, 'That email and password don\'t match. Try again, or email yourself a sign-in link.')
      onSignedIn()
    })

    forms.link.addEventListener('submit', async (e) => {
      e.preventDefault()
      const btn = $('button[type=submit]', forms.link)
      btn.disabled = true
      const { error } = await client.auth.signInWithOtp({
        email: forms.link.email.value.trim(),
        options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
      })
      btn.disabled = false
      // Same answer either way, so the form can't be used to test which emails have accounts.
      if (error && error.status && error.status >= 500) return showMsg(msg, 'We couldn\'t send the link just now. Try again in a minute.')
      showMsg(msg, 'If that email has an account, a sign-in link is on its way. It works once and expires in an hour.', 'ok')
    })

    $('#forgot', root).addEventListener('click', async () => {
      const email = forms.password.email.value.trim()
      if (!email) return showMsg(msg, 'Enter your email first, then press "Forgot password".')
      await client.auth.resetPasswordForEmail(email, { redirectTo: redirectTo + '?reset=1' })
      showMsg(msg, 'If that email has an account, a reset link is on its way.', 'ok')
    })

    const newPw = $('#form-newpw', root)
    client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        Object.values(forms).forEach((f) => f.classList.add('hidden'))
        $('.tabs', root).classList.add('hidden')
        newPw.classList.remove('hidden')
      }
    })
    newPw.addEventListener('submit', async (e) => {
      e.preventDefault()
      const pw = newPw.password.value
      if (pw.length < 10) return showMsg(msg, 'Use at least 10 characters.')
      const { error } = await client.auth.updateUser({ password: pw })
      if (error) return showMsg(msg, error.message)
      history.replaceState(null, '', redirectPath)
      onSignedIn()
    })
  }

  async function signOut(path) {
    await client.auth.signOut()
    location.href = path
  }

  window.App = { cfg, client, call, $, $$, esc, brandLogo, showMsg, mountSignIn, signOut, token }
})()
