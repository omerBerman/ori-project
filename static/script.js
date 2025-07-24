/**
 * Radio Mixer – mobile-optimized ES6 version
 * - Single RAF loop for all fades
 * - Better touch/pointer handling (no scroll/zoom issues)
 * - Non-silent rule keeps one channel at DEFAULT volume
 * - Clean state management with a small class
 * - No visual/style changes (same HTML/CSS)
 */

"use strict";

/* ---------- constants ---------- */
const STEPS        = 4;       // 0,25,50,75,100%
const PCT          = 100 / STEPS;
const DEFAULT_STEP = 3;       // 75% on boot / fallback
const XFADE_MS     = 2000;    // crossfade duration
const QUIET_DELAY  = 300;     // ms before auto-fallback fires

/* ---------- DOM ---------- */
const sliders = [...document.querySelectorAll(".v-slider")];
const fills   = [...document.querySelectorAll(".slider-fill")];
const tracks  = [...document.querySelectorAll(".track")];
const overlay = document.getElementById("unlock");

/**
 * Utility functions
 */
const clamp      = (v, min, max) => Math.max(min, Math.min(max, v));
const pct        = s => s * PCT;
const nextIdx    = i => (i + 1) % tracks.length;
const audibleAny = () => tracks.some(t => t.volume > 0.0001);

/**
 * Convert pointer/touch Y to step (0..STEPS)
 */
function stepFromY(y, rect) {
  const rel = 1 - (y - rect.top) / rect.height; // 0 bottom -> 1 top
  return clamp(Math.round(rel * STEPS), 0, STEPS);
}

/**
 * Mixer class
 */
class Mixer {
  constructor() {
    this.active    = 0;
    this.fading    = false;
    this.fadeTo    = 0;
    this.fadeVol   = 1;
    this.fadeStart = 0;
    this.quietTimer = null;
    this.unlocked   = false;

    // Pre-configure tracks
    tracks.forEach(t => {
      t.loop = true;
      t.volume = 0;
      // Try to autoplay; many browsers block until user gesture.
      t.play().catch(() => {});
    });

    // Default bar display (without playing aloud yet)
    this.setBar(0, pct(DEFAULT_STEP));

    // Attach interaction handlers
    this.bindBars();

    // Start RAF loop
    requestAnimationFrame(this.raf.bind(this));
  }

  unlockAudio() {
    if (this.unlocked) return;
    this.unlocked = true;
    overlay && overlay.classList.add("d-none");
    tracks.forEach(t => t.play().catch(() => {}));
    // Set default volume for station 0
    tracks[0].volume = DEFAULT_STEP / STEPS;
    this.setBar(0, pct(DEFAULT_STEP));
  }

  /**
   * Ensure at least one channel is playing
   */
  ensureNotSilent() {
    if (audibleAny() || this.fading) return;

    this.active = nextIdx(this.active);
    const prev  = tracks[this.active === 0 ? tracks.length - 1 : this.active - 1];
    const cur   = tracks[this.active];

    cur.currentTime = prev.currentTime % cur.duration;
    cur.volume = DEFAULT_STEP / STEPS;
    this.setBar(this.active, pct(DEFAULT_STEP));
  }

  /**
   * RAF loop: handles fade progression
   */
  raf(now) {
    if (this.fading) {
      const t = clamp((now - this.fadeStart) / XFADE_MS, 0, 1);
      const from = tracks[this.active];
      const to   = tracks[this.fadeTo];

      const vOut = this.fadeVol * (1 - t);
      const vIn  = this.fadeVol * t;

      from.volume = vOut;
      to.volume   = vIn;

      this.setBar(this.active, pct(STEPS) * (vOut / this.fadeVol));
      this.setBar(this.fadeTo, pct(STEPS) * (vIn  / this.fadeVol));

      if (t === 1) {
        from.pause();
        from.currentTime = to.currentTime;
        this.active = this.fadeTo;
        this.fading = false;
        this.ensureNotSilent();
      }
    }
    requestAnimationFrame(this.raf.bind(this));
  }

  /**
   * Set fill percentage on bar
   */
  setBar(idx, percent) {
    fills[idx].style.height = `${percent}%`;
  }

  /**
   * Change volume or begin fade
   */
  change(idx, step) {
    const volVal = step / STEPS;
    const volPct = pct(step);

    // Same bar: just set volume
    if (idx === this.active && !this.fading) {
      tracks[idx].volume = volVal;
      this.setBar(idx, volPct);
      this.ensureNotSilent();
      return;
    }
    // If fading in progress, ignore new requests
    if (this.fading) return;

    // Start fade
    this.fading    = true;
    this.fadeTo    = idx;
    this.fadeVol   = volVal;
    this.fadeStart = performance.now();

    const from = tracks[this.active];
    const to   = tracks[this.fadeTo];

    to.currentTime = from.currentTime % to.duration;
    to.volume = 0;
    to.play().catch(() => {});
    from.volume = volVal;
    this.setBar(this.fadeTo, 0);
  }

  bindBars() {
    sliders.forEach((slider, idx) => {
      slider.style.userSelect = "none";
      slider.style.touchAction = "none"; // prevent scroll on touch
      const rect = slider.getBoundingClientRect();

      let dragging = false;

      const start = e => {
        e.preventDefault();
        this.unlockAudio();
        dragging = true;
        move(e);
      };

      const move = e => {
        if (!dragging) return;
        const y = e.touches ? e.touches[0].clientY : e.clientY;
        this.change(idx, stepFromY(y, rect));
      };

      const end = e => {
        dragging = false;
        clearTimeout(this.quietTimer);
        this.quietTimer = setTimeout(() => this.ensureNotSilent(), QUIET_DELAY);
      };

      // Pointer events
      slider.addEventListener("pointerdown", start, { passive: false });
      slider.addEventListener("pointermove", move,  { passive: false });
      window.addEventListener("pointerup", end,     { passive: true });
      window.addEventListener("pointercancel", end, { passive: true });

      // iOS Safari long-press context menu/prevent selection
      slider.addEventListener("contextmenu", e => e.preventDefault());
    });
  }
}

// Initialize after DOM ready
document.addEventListener("DOMContentLoaded", () => {
  new Mixer();
});