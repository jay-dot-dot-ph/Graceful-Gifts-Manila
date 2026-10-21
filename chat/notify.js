// Each browser/device must unlock Web Audio from its own user gesture.
export function createNotifier(kind, changed = () => {}) {
  const key = `ggm-chat-sound-${kind}`;
  let preferred = false;
  try { preferred = localStorage.getItem(key) === 'on'; } catch {}
  let context = null;
  let state = preferred ? 'enable' : 'off';
  const report = () => { changed(state); return state; };
  const tone = () => {
    if (!context || context.state !== 'running') { state = 'blocked'; report(); return false; }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    // A square wave has more audible energy than a sine wave at the same full-scale peak.
    oscillator.type = 'square'; oscillator.frequency.setValueAtTime(720, context.currentTime);
    oscillator.frequency.setValueAtTime(880, context.currentTime + .23);
    gain.gain.setValueAtTime(.001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(1, context.currentTime + .015);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .17);
    gain.gain.setValueAtTime(.001, context.currentTime + .21);
    gain.gain.exponentialRampToValueAtTime(1, context.currentTime + .24);
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .48);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(); oscillator.stop(context.currentTime + .49);
    return true;
  };
  return {
    get state() { return state; },
    async toggle() {
      if (state === 'on') {
        state = 'off'; preferred = false; try { localStorage.setItem(key, 'off'); } catch {}
        await context?.suspend(); report(); return;
      }
      try {
        context ||= new (window.AudioContext || window.webkitAudioContext)();
        await context.resume();
        if (context.state !== 'running') throw new Error('Audio is blocked');
        state = 'on'; preferred = true; try { localStorage.setItem(key, 'on'); } catch {}
        tone(); report();
      } catch { state = 'blocked'; report(); }
    },
    notify() { if (state === 'on' && document.visibilityState === 'visible') return tone(); return false; },
    label() { return state === 'on' ? 'Sounds on' : state === 'blocked' ? 'Sound blocked — tap to retry' : 'Enable sounds'; }
  };
}
