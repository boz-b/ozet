/* Progressive enhancement only: the chapters, figures, tables, navigation and
   worked example remain readable without JavaScript. No network requests or
   third-party analytics are needed by either guide. */
(() => {
  'use strict';
  const links = [...document.querySelectorAll('.sidebar .contents a[href^="#"]')];
  const chapters = [...document.querySelectorAll('section.chapter[id]')];
  const progress = document.querySelector('.progress');
  let scheduled = false;
  function updateReadingPosition() {
    // Use document geometry rather than assuming chapters have equal lengths.
    // The last chapter above the reading line determines the active contents.
    let current = chapters[0];
    for (const chapter of chapters) {
      if (chapter.getBoundingClientRect().top <= 170) current = chapter;
    }
    for (const link of links) {
      const active = current && link.hash === '#' + current.id;
      link.classList.toggle('active', Boolean(active));
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
    const available = document.documentElement.scrollHeight - innerHeight;
    if (progress) progress.style.width = (available > 0 ? Math.min(100, scrollY / available * 100) : 0) + '%';
    scheduled = false;
  }
  addEventListener('scroll', () => {
    if (!scheduled) { requestAnimationFrame(updateReadingPosition); scheduled = true; }
  }, {passive: true});
  addEventListener('resize', updateReadingPosition);
  updateReadingPosition();
  document.querySelectorAll('.mobile-contents a').forEach(link => {
    link.addEventListener('click', () => link.closest('details').removeAttribute('open'));
  });

  // This is a deliberately simple hypothetical annual cost model, not a VHF
  // forecast. Turnover means total dollars bought PLUS sold / initial capital;
  // it is not the half-L1 turnover used by some portfolio reporting systems.
  const turnover = document.getElementById('turnover');
  const cost = document.getElementById('trade-cost');
  if (turnover && cost) {
    const money = value => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', maximumFractionDigits:0}).format(value);
    function updateCostExample() {
      const traded = Number(turnover.value) / 100;
      const rate = Number(cost.value) / 10000;
      const expense = 100000 * traded * rate;
      document.getElementById('turnover-value').textContent = turnover.value + '%';
      document.getElementById('cost-value').textContent = cost.value + ' basis points';
      document.getElementById('cost-dollars').textContent = money(expense);
      document.getElementById('net-return').textContent = ((8000 - expense) / 1000).toFixed(2) + '%';
      document.getElementById('ending-capital').textContent = money(108000 - expense);
    }
    turnover.addEventListener('input', updateCostExample);
    cost.addEventListener('input', updateCostExample);
    updateCostExample();
  }
})();
