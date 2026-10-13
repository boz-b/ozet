/* Two progressive enhancements for the explainer: a deliberately synthetic
   pending-order range and expanded notes for printing. No market calculations,
   saved user data, network access or project runtime are involved. */
(() => {
  'use strict';
  const candidate = document.getElementById('candidate-shares');
  if (candidate) {
    function updateEnvelope() {
      // Confirmed 100, existing buy 50 and sell 80 give [20,150]. A candidate
      // buy increases only the upper bound: its minimum fill is zero. The
      // 0–250 visual scale covers every setting of this illustrative slider.
      const buy = Number(candidate.value);
      document.getElementById('candidate-label').textContent = `${buy} shares`;
      document.getElementById('envelope-result').textContent = `20–${150 + buy}`;
      document.getElementById('range-after').style.width = `${(130 + buy) / 250 * 100}%`;
    }
    candidate.addEventListener('input', updateEnvelope);
    updateEnvelope();
  }
  let closedBeforePrint = [];
  addEventListener('beforeprint', () => {
    // Preserve the reader's disclosure choices when returning from print.
    closedBeforePrint = [...document.querySelectorAll('main details:not([open])')]
      .filter(detail => !detail.classList.contains('mobile-contents'));
    closedBeforePrint.forEach(detail => { detail.open = true; });
  });
  addEventListener('afterprint', () => {
    closedBeforePrint.forEach(detail => { detail.open = false; });
    closedBeforePrint = [];
  });
})();
