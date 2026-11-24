'use strict'
// Hash-based view switching shared by both portals.
;(function () {
  function mountViews(defaultView) {
    const { $$ } = window.App
    function show() {
      const wanted = (location.hash || '#' + defaultView).slice(1)
      const pages = $$('[data-page]')
      const target = pages.some((p) => p.dataset.page === wanted) ? wanted : defaultView
      pages.forEach((p) => p.classList.toggle('hidden', p.dataset.page !== target))
      $$('[data-view]').forEach((a) => {
        if (a.dataset.view === target) a.setAttribute('aria-current', 'page')
        else a.removeAttribute('aria-current')
      })
    }
    addEventListener('hashchange', show)
    show()
    return { go: (v) => { location.hash = v } }
  }
  window.App.mountViews = mountViews
})()
