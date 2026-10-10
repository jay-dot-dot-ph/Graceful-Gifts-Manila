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
    // Extra staggered slots keep at least twelve visible while others enter or leave.
    if (opening.clientWidth >= 1100 && opening.clientHeight >= 600) return 16;
    if (opening.clientWidth >= 700 && opening.clientHeight >= 600) return 5;
    return 3;
  }
  function updateTiming() {
    const desktop = targetCount() === 16;
    duration = desktop ? 1800 : 1500;
    enter = desktop ? 150 : 180;
    hold = desktop ? 1400 : 1050;
  }
  function measure(card) {
    const width = opening.clientWidth;
    const height = opening.clientHeight;
    const compact = width < 700 || height < 520;
    const desktop = width >= 1100 && height >= 600;
    const maxWidth = width <= 340 ? width * 0.52 : compact ? Math.min(width * 0.64, 250) : desktop ? 215 : 290;
    const maxHeight = compact ? Math.min(height * 0.24, 220) : desktop ? 220 : Math.min(height * 0.38, 340);
    const ratio = Math.min(compact ? 0.78 : desktop ? 0.72 : 0.82, maxWidth / card.naturalWidth, maxHeight / card.naturalHeight);
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
    const xs = [inset, (inset + maxX) / 2, maxX];
    const ys = [inset, (inset + maxY) / 2, maxY];
    let best = null;
    for (let attempt = 0; attempt < 140; attempt++) {
      const x = attempt < 9 ? xs[attempt % 3] : randomBetween(inset, maxX);
      const y = attempt < 9 ? ys[Math.floor(attempt / 3)] : randomBetween(inset, maxY);
      const rect = { left: x, top: y, right: x + card.width, bottom: y + card.height };
      if (overlapArea(rect, reserved)) continue;
      const overlap = [...active].reduce((total, entry) => total + overlapArea(rect, entry.rect) / Math.min(card.width * card.height, entry.card.width * entry.card.height), 0);
      if (!best || overlap < best.overlap) best = { rect, overlap };
      if (overlap < 0.04) break;
    }
    if (!best || best.overlap > 0.38) return null;
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
    for (let slot = 0; slot < slotCount; slot++) show(slot, slot * duration / slotCount);
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
  function fadeFinalGroup() {
    if (reduceMotion) return;
    for (const entry of active) entry.card.element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 550, easing: 'ease-in-out', fill: 'forwards' });
  }

  for (const card of cards) {
    card.image.addEventListener('load', () => { if (!finalGroup) start(); }, { once: true });
    card.image.src = card.image.dataset.src;
  }
  start();
  setTimeout(() => start(true), 800);
  setTimeout(holdFinalGroup, 5800);
  setTimeout(fadeFinalGroup, 7000);
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
    for (let slot = 0; slot < slotCount; slot++) show(slot, slot * duration / slotCount);
  });
  opening.addEventListener('animationend', (event) => {
    if (event.target !== opening) return;
    for (const entry of active) entry.animation?.cancel();
    app.inert = false;
    opening.remove();
  });
})();
