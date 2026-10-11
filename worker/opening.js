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
  let partialStartAllowed = false;
  const desktopSlots = [
    [.12, .13], [.88, .87], [.38, .13], [.62, .87],
    [.88, .13], [.12, .87], [.62, .13], [.38, .87],
    [.12, .37], [.88, .63], [.88, .37], [.12, .63],
  ];

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
    if (opening.clientWidth >= 1100 && opening.clientHeight >= 600) return desktopSlots.length;
    if (opening.clientWidth >= 700 && opening.clientHeight >= 600) return 5;
    return 3;
  }
  function updateTiming() {
    const desktop = targetCount() === desktopSlots.length;
    duration = desktop ? 7000 : 1500;
    enter = desktop ? 650 : 180;
    hold = 1050;
  }
  function measure(card) {
    const width = opening.clientWidth;
    const height = opening.clientHeight;
    const compact = width < 700 || height < 520;
    const desktop = width >= 1100 && height >= 600;
    const maxWidth = width <= 340 ? width * 0.56 : compact ? Math.min(width * 0.68, 265) : desktop ? Math.min(132, width * 0.122) : 305;
    const maxHeight = compact ? Math.min(height * 0.255, 232) : desktop ? Math.min(height < 680 ? 88 : 142, height * 0.2) : Math.min(height * 0.4, 355);
    const ratio = Math.min(compact ? 0.82 : desktop ? 0.55 : 0.86, maxWidth / card.naturalWidth, maxHeight / card.naturalHeight);
    card.width = card.naturalWidth * ratio;
    card.height = card.naturalHeight * ratio;
    card.element.style.width = `${card.width}px`;
    card.element.style.height = `${card.height}px`;
  }
  function position(card, slot) {
    measure(card);
    const width = opening.clientWidth;
    const height = opening.clientHeight;
    const inset = 12;
    if (card.width + inset * 2 > width || card.height + inset * 2 > height) return null;
    const logo = brand.getBoundingClientRect();
    const desktop = targetCount() === desktopSlots.length;
    const clearance = desktop ? 46 : 12;
    const reserved = { left: logo.left - clearance, top: logo.top - clearance, right: logo.right + clearance, bottom: logo.bottom + clearance };
    const maxX = width - card.width - inset;
    const maxY = height - card.height - inset;
    if (desktop) {
      const [column, row] = desktopSlots[slot];
      const x = Math.max(inset, Math.min(maxX, width * column - card.width / 2));
      let y = height * row - card.height / 2;
      if (x < reserved.right && x + card.width > reserved.left) {
        if (row < 0.5) y = Math.min(y, reserved.top - card.height - 12);
        else y = Math.max(y, reserved.bottom + 12);
      }
      y = Math.max(inset, Math.min(maxY, y));
      const rect = { left: x, top: y, right: x + card.width, bottom: y + card.height };
      if (overlapArea(rect, reserved)) return null;
      card.element.style.left = `${x}px`;
      card.element.style.top = `${y}px`;
      card.element.dataset.slot = String(slot);
      return rect;
    }
    const columns = width >= 1300 ? 10 : 9;
    const rows = height >= 800 ? 6 : 5;
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
    if (!best || best.overlap > 0.38) return null;
    card.element.style.left = `${best.rect.left}px`;
    card.element.style.top = `${best.rect.top}px`;
    return best.rect;
  }
  function nextCard(slot) {
    if (!deck.length) deck = shuffle(cards.filter((card) => card.image.complete && card.image.naturalWidth));
    const attempts = deck.length;
    for (let index = 0; index < attempts; index++) {
      const card = deck.shift();
      if ([...active].some((entry) => entry.card === card)) { deck.push(card); continue; }
      const rect = position(card, slot);
      if (rect) return { card, rect };
      deck.push(card);
    }
    return null;
  }
  function show(slot, offset = 0) {
    if (finalGroup) return;
    const selected = nextCard(slot);
    if (!selected) { setTimeout(() => show(slot), 100); return; }
    const entry = { ...selected, animation: null };
    active.add(entry);
    entry.card.element.dataset.active = 'true';
    if (reduceMotion) {
      entry.card.element.style.opacity = '1';
      return;
    }
    const desktop = slotCount === desktopSlots.length;
    const direction = Math.random() < 0.5 ? -1 : 1;
    const animation = entry.card.element.animate(desktop ? [
      { opacity: 0, transform: 'scale(.94)', offset: 0 },
      { opacity: 1, transform: 'scale(1)', offset: enter / duration },
      { opacity: 1, transform: 'scale(1)', offset: 1 },
    ] : [
      { opacity: 0, transform: `translateY(${7 * direction}px)`, offset: 0 },
      { opacity: 1, transform: 'translateY(0px)', offset: enter / duration },
      { opacity: 1, transform: `translateY(${-4 * direction}px)`, offset: (enter + hold) / duration },
      { opacity: 0, transform: `translateY(${-8 * direction}px)`, offset: 1 },
    ], { duration, delay: desktop ? offset : -offset, easing: 'ease-in-out', fill: 'forwards' });
    entry.animation = animation;
    animation.finished.then(() => {
      active.delete(entry);
      entry.card.element.dataset.active = 'false';
      animation.cancel();
      show(slot);
    }).catch(() => {});
  }
  function start() {
    if (started) return;
    updateTiming();
    slotCount = targetCount();
    const ready = cards.filter((card) => card.image.complete && card.image.naturalWidth).length;
    if (ready < (partialStartAllowed ? 2 : slotCount)) return;
    started = true;
    for (let slot = 0; slot < slotCount; slot++) show(slot, slot * (slotCount === desktopSlots.length ? 135 : duration / slotCount));
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

  const initialCards = targetCount() === desktopSlots.length ? shuffle(cards).slice(0, 16) : cards;
  for (const card of cards) {
    card.image.addEventListener('load', () => { if (!finalGroup) start(); }, { once: true });
  }
  for (const card of initialCards) {
    card.image.src = card.image.dataset.src;
  }
  start();
  setTimeout(() => { partialStartAllowed = true; start(); }, 800);
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
    if (slotCount !== desktopSlots.length) for (const card of cards) if (!card.image.src) card.image.src = card.image.dataset.src;
    for (let slot = 0; slot < slotCount; slot++) show(slot, slot * (slotCount === desktopSlots.length ? 135 : duration / slotCount));
  });
  opening.addEventListener('animationend', (event) => {
    if (event.target !== opening) return;
    for (const entry of active) entry.animation?.cancel();
    app.inert = false;
    opening.remove();
  });
})();
