/**
 * sound.ts
 * ========
 * Lightweight audio utilities for notification sounds.
 * Uses the Web Audio API to generate tones programmatically —
 * no external audio files needed.
 */

/** Play a short alert chime (double beep) */
export function playAlertSound(): void {
  try {
    const ctx = new AudioContext();

    function beep(startTime: number, freq: number, duration: number) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.15, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.start(startTime);
      osc.stop(startTime + duration);
    }

    const t = ctx.currentTime;
    beep(t,        880, 0.12);   // first beep
    beep(t + 0.15, 1100, 0.12);  // second beep (higher)

    // Clean up AudioContext after sounds finish
    setTimeout(() => ctx.close(), 800);
  } catch {
    // Web Audio API not available (very old browser) — silently ignore
  }
}

/** Play a gentle success chime */
export function playSuccessSound(): void {
  try {
    const ctx = new AudioContext();

    function note(startTime: number, freq: number, duration: number) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.1, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.start(startTime);
      osc.stop(startTime + duration);
    }

    const t = ctx.currentTime;
    note(t,        523, 0.1);   // C5
    note(t + 0.1,  659, 0.1);   // E5
    note(t + 0.2,  784, 0.18);  // G5

    setTimeout(() => ctx.close(), 1000);
  } catch { /* noop */ }
}

/** Play a soft notification ping */
export function playNotificationSound(): void {
  try {
    const ctx  = new AudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
    setTimeout(() => ctx.close(), 600);
  } catch { /* noop */ }
}
