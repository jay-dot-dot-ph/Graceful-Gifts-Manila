// Each browser/device must unlock Web Audio from its own user gesture.
export function createNotifier(kind, changed = () => {}) {
  const key = `ggm-chat-sound-${kind}`;
  let preferred = true;
  try { preferred = localStorage.getItem(key) !== 'off'; } catch {}
  let context = null;
  let state = preferred ? 'enable' : 'off';
  const report = () => { changed(state); return state; };
  const tone = () => {
    if (!context || context.state !== 'running') { state = 'blocked'; report(); return false; }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(784, context.currentTime);
    gain.gain.setValueAtTime(.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(1, context.currentTime + .012);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .32);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + .33);
    return true;
  };
  const unlock = async (testSound = false) => {
    try {
      context ||= new (window.AudioContext || window.webkitAudioContext)();
      await context.resume();
      if (context.state !== 'running') throw new Error('Audio is blocked');
      state = 'on'; preferred = true;
      try { localStorage.setItem(key, 'on'); } catch {}
      if (testSound) tone();
      report();
    } catch { state = 'blocked'; report(); }
  };
  // Mobile browsers may suspend audio after a reload or when a tab is backgrounded.
  // A later tap or key press can resume the saved preference with a fresh user gesture.
  const resumeOnGesture = (event) => {
    if (!preferred || event.target?.closest?.('[data-sound]')) return;
    if (state !== 'on' || context?.state !== 'running') unlock();
  };
  document.addEventListener('pointerup', resumeOnGesture, true);
  document.addEventListener('touchend', resumeOnGesture, { capture: true, passive: true });
  document.addEventListener('keydown', resumeOnGesture, true);
  return {
    get state() { return state; },
    get enabled() { return preferred; },
    async toggle() {
      if (preferred) {
        state = 'off'; preferred = false; try { localStorage.setItem(key, 'off'); } catch {}
        await context?.suspend(); report(); return;
      }
      await unlock(true);
    },
    notify() { if (state === 'on' && document.visibilityState === 'visible') return tone(); return false; },
    label() { return preferred ? 'Mute sounds' : 'Unmute sounds'; }
  };
}
