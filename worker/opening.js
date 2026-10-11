(() => {
  const opening = document.getElementById('opening-screen');
  const app = document.getElementById('app');
  if (document.documentElement.classList.contains('opening-route-skip')) {
    opening.remove();
    return;
  }

  app.inert = true;
  const brand = opening.querySelector('.opening-brand');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cards = [...opening.querySelectorAll('.opening-feedback')].map((element) => ({
    element,
    image: element.querySelector('img'),
    naturalWidth: Number(element.dataset.width),
    naturalHeight: Number(element.dataset.height),
    width: 0,
    height: 0,
  }));
  const active = new Set();
  const isDesktop = () => window.innerWidth >= 1100 && window.innerHeight >= 600;
  let duration = 1500;
  let enter = 180;
  let hold = 1050;
  let deck = [];
  let started = false;
  let finalGroup = false;
  let slotCount = 0;

  const randomBetween = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);
  const overlapArea = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  function shuffle(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }
  function targetCount() {
    // Show every supplied feedback photo together on desktop.
    if (isDesktop()) return cards.length;
    if (opening.clientWidth >= 700 && opening.clientHeight >= 600) return 5;
    return 3;
  }
  function updateTiming() {
    const desktop = isDesktop();
    duration = desktop ? 6000 : 1500;
    enter = desktop ? 900 : 180;
    hold = desktop ? 4200 : 1050;
  }
  function measure(card) {
    const width = opening.clientWidth;
    const height = opening.clientHeight;
    const compact = width < 700 || height < 520;
    const desktop = isDesktop();
    const maxWidth = width <= 340 ? width * 0.56 : compact ? Math.min(width * 0.68, 265) : desktop ? Math.min(132, width * 0.1) : 305;
    const maxHeight = compact ? Math.min(height * 0.255, 232) : desktop ? Math.min(142, height * 0.18) : Math.min(height * 0.4, 355);
    const ratio = Math.min(compact ? 0.82 : desktop ? 0.55 : 0.86, maxWidth / card.naturalWidth, maxHeight / card.naturalHeight);
    card.width = card.naturalWidth * ratio;
    card.height = card.naturalHeight * ratio;
    card.element.style.width = `${card.width}px`;
    card.element.style.height = `${card.height}px`;
  }
  function position(card) {
    measure(card);
    const width = opening.clientWidth;
    const height = opening.clientHeight;
    const inset = 12;
    if (card.width + inset * 2 > width || card.height + inset * 2 > height) return null;
    const logo = brand.getBoundingClientRect();
    const reserved = { left: logo.left - 12, top: logo.top - 12, right: logo.right + 12, bottom: logo.bottom + 12 };
    const maxX = width - card.width - inset;
    const maxY = height - card.height - inset;
    const columns = isDesktop() ? (width >= 1300 ? 13 : 11) : (width >= 1300 ? 12 : 10);
    const rows = isDesktop() ? (height >= 800 ? 8 : 7) : (height >= 800 ? 7 : 6);
    const grid = shuffle(Array.from({ length: columns * rows }, (_, index) => ({
      x: Math.max(inset, Math.min(maxX, width * ((index % columns) + 0.5) / columns - card.width / 2)),
      y: Math.max(inset, Math.min(maxY, height * (Math.floor(index / columns) + 0.5) / rows - card.height / 2)),
    })));
    let best = null;
    for (let attempt = 0; attempt < grid.length + 80; attempt++) {
      const x = attempt < grid.length ? grid[attempt].x : randomBetween(inset, maxX);
      const y = attempt < grid.length ? grid[attempt].y : randomBetween(inset, maxY);
      const rect = { left: x, top: y, right: x + card.width, bottom: y + card.height };
      if (overlapArea(rect, reserved)) continue;
      const overlap = [...active].reduce((total, entry) => total + overlapArea(rect, entry.rect) / Math.min(card.width * card.height, entry.card.width * entry.card.height), 0);
      if (!best || overlap < best.overlap) best = { rect, overlap };
      if (overlap < 0.04) break;
    }
    if (!best || best.overlap > (isDesktop() ? 0.62 : 0.38)) return null;
    card.element.style.left = `${best.rect.left}px`;
    card.element.style.top = `${best.rect.top}px`;
    return best.rect;
  }
  function nextCard() {
    if (!deck.length) deck = shuffle(cards.filter((card) => card.image.complete && card.image.naturalWidth));
    const attempts = deck.length;
    for (let index = 0; index < attempts; index++) {
      const card = deck.shift();
      if ([...active].some((entry) => entry.card === card)) { deck.push(card); continue; }
      const rect = position(card);
      if (rect) return { card, rect };
      deck.push(card);
    }
    return null;
  }
  function show(slot, offset = 0) {
    if (finalGroup) return;
    const selected = nextCard();
    if (!selected) { setTimeout(() => show(slot), 100); return; }
    const entry = { ...selected, animation: null };
    active.add(entry);
    entry.card.element.dataset.active = 'true';
    if (reduceMotion) {
      entry.card.element.style.opacity = '1';
      return;
    }
    if (isDesktop()) {
      entry.animation = entry.card.element.animate([
        { opacity: 0, transform: 'translateY(8px) scale(.96)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ], { duration: 900, delay: offset, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
      return;
    }
    const direction = Math.random() < 0.5 ? -1 : 1;
    const animation = entry.card.element.animate([
      { opacity: 0, transform: `translateY(${7 * direction}px)`, offset: 0 },
      { opacity: 1, transform: 'translateY(0px)', offset: enter / duration },
      { opacity: 1, transform: `translateY(${-4 * direction}px)`, offset: (enter + hold) / duration },
      { opacity: 0, transform: `translateY(${-8 * direction}px)`, offset: 1 },
    ], { duration, delay: -offset, easing: 'ease-in-out', fill: 'forwards' });
    entry.animation = animation;
    animation.finished.then(() => {
      active.delete(entry);
      entry.card.element.dataset.active = 'false';
      animation.cancel();
      show(slot);
    }).catch(() => {});
  }
  function start(allowPartial = false) {
    if (started) return;
    updateTiming();
    slotCount = targetCount();
    const ready = cards.filter((card) => card.image.complete && card.image.naturalWidth).length;
    if (ready < (allowPartial ? 2 : slotCount)) return;
    started = true;
    for (let slot = 0; slot < slotCount; slot++) show(slot, isDesktop() ? slot * 35 : slot * duration / slotCount);
  }
  function holdFinalGroup() {
    finalGroup = true;
    for (const entry of active) {
      const current = Number(getComputedStyle(entry.card.element).opacity);
      entry.animation?.cancel();
      entry.animation = null;
      entry.card.element.style.opacity = String(current);
      if (!reduceMotion) entry.card.element.animate([{ opacity: current }, { opacity: 1 }], { duration: 200, easing: 'ease-out', fill: 'forwards' });
    }
  }
  for (const card of cards) {
    card.image.addEventListener('load', () => { if (!finalGroup) start(); }, { once: true });
    card.image.src = card.image.dataset.src;
  }
  start();
  setTimeout(() => start(true), 800);
  setTimeout(holdFinalGroup, 5800);
  window.addEventListener('resize', () => {
    if (!started || finalGroup) return;
    for (const entry of active) {
      entry.animation?.cancel();
      entry.card.element.style.opacity = '0';
      entry.card.element.dataset.active = 'false';
    }
    active.clear();
    deck = [];
    updateTiming();
    slotCount = targetCount();
    for (let slot = 0; slot < slotCount; slot++) show(slot, isDesktop() ? slot * 35 : slot * duration / slotCount);
  });
  opening.addEventListener('animationend', (event) => {
    if (event.target !== opening) return;
    for (const entry of active) entry.animation?.cancel();
    app.inert = false;
    opening.remove();
  });
})();
