(() => {
  const opening = document.getElementById('opening-screen');
  const app = document.getElementById('app');
  if (document.documentElement.classList.contains('opening-route-skip')) {
    opening.remove();
    return;
  }

  app.inert = true;
  const cards = [...opening.querySelectorAll('.opening-feedback')].map((element) => ({
    element,
    width: Number(element.dataset.width),
    height: Number(element.dataset.height),
  }));
  // Request every supplied image while the opening is shown, including ones too large
  // to display at native size on the current screen.
  for (const { element } of cards) element.querySelector('img').src = element.querySelector('img').dataset.src;

  const brand = opening.querySelector('.opening-brand');
  const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const holds = [2, 300, 500, 700, 900, 2000];
  const active = new Set();
  let queue = [];
  let interval;
  let stopped = false;
  let sequence = 0;
  const shuffled = (items) => {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  };
  const intersects = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

  function position(card) {
    const viewport = { width: opening.clientWidth, height: opening.clientHeight };
    if (card.width + 16 > viewport.width || card.height + 32 > viewport.height) return false;
    const logo = brand.getBoundingClientRect();
    const protectedArea = { left: logo.left - 16, top: logo.top - 16, right: logo.right + 16, bottom: logo.bottom + 16 };
    let best = null;
    for (let attempt = 0; attempt < 90; attempt++) {
      const x = 8 + Math.random() * Math.max(0, viewport.width - card.width - 16);
      const y = 16 + Math.random() * Math.max(0, viewport.height - card.height - 32);
      const rect = { left: x, top: y, right: x + card.width, bottom: y + card.height };
      if (viewport.width > 340 && viewport.height > 500 && intersects(rect, protectedArea)) continue;
      const overlap = [...active].reduce((sum, other) => sum + intersects(rect, other.rect) / Math.min(card.width * card.height, other.card.width * other.card.height), 0);
      if (!best || overlap < best.overlap) best = { x, y, rect, overlap };
      if (overlap < 0.08) break;
    }
    if (!best) return false;
    card.element.style.left = `${best.x}px`;
    card.element.style.top = `${best.y}px`;
    card.element.style.width = `${card.width}px`;
    card.element.style.height = `${card.height}px`;
    return best.rect;
  }

  function show(card, delay = 0) {
    const rect = position(card);
    if (!rect) return false;
    const entry = { card, rect, animation: null };
    active.add(entry);
    card.element.dataset.active = 'true';
    if (!motion) {
      card.element.style.opacity = '1';
      return true;
    }
    const hold = sequence < 3 ? 2000 : holds[sequence % holds.length];
    sequence++;
    const duration = 150 + hold + 260;
    const direction = sequence % 2 ? -1 : 1;
    const animation = card.element.animate([
      { opacity: 0, transform: `translateY(${10 * direction}px)`, offset: 0 },
      { opacity: 1, transform: 'translateY(0px)', offset: 150 / duration },
      { opacity: 1, transform: `translateY(${-5 * direction}px)`, offset: (150 + hold) / duration },
      { opacity: 0, transform: `translateY(${-12 * direction}px)`, offset: 1 },
    ], { duration, delay, easing: 'ease-in-out', fill: 'forwards' });
    entry.animation = animation;
    animation.finished.then(() => {
      active.delete(entry);
      card.element.dataset.active = 'false';
      animation.cancel();
    }).catch(() => {});
    return true;
  }

  function refill() {
    if (stopped) return;
    const available = cards.filter((card) => card.width + 16 <= opening.clientWidth && card.height + 32 <= opening.clientHeight);
    const target = Math.min(available.length, opening.clientWidth < 500 ? 6 : opening.clientWidth < 900 ? 8 : 14);
    if (!queue.length) queue = shuffled(available);
    let attempts = 0;
    while (active.size < target && attempts++ < available.length) {
      if (!queue.length) queue = shuffled(available);
      const card = queue.shift();
      if (card && ![...active].some((entry) => entry.card === card)) show(card, active.size < 3 ? 2 : holds[(sequence + active.size) % holds.length]);
    }
  }

  refill();
  interval = setInterval(refill, 120);
  opening.addEventListener('animationend', (event) => {
    if (event.target !== opening) return;
    stopped = true;
    clearInterval(interval);
    for (const entry of active) entry.animation?.cancel();
    app.inert = false;
    opening.remove();
  });
})();
