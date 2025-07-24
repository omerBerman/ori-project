"use strict";

/**
 * Radio Mixer – mobile friendly version with stronger volume steps.
 * No visual/style changes, only behavior.
 */

/* ---- volume steps ---- */
const LEVELS       = [0, 0.35, 0.7, 1];   // 0%, 35%, 70%, 100%
const STEPS        = LEVELS.length - 1;   // index from 0..3
const DEFAULT_STEP = STEPS;               // start/fallback at 100%

/* ---- fade & misc constants ---- */
const XFADE_MS     = 2000;                // crossfade duration
const QUIET_DELAY  = 300;                 // ms before auto fallback

/* ---- DOM ---- */
const sliders = [...document.querySelectorAll(".v-slider")];
const fills   = [...document.querySelectorAll(".slider-fill")];
const tracks  = [...document.querySelectorAll(".track")];
const overlay = document.getElementById("unlock");

/* ---- helpers ---- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PCT   = step => LEVELS[step] * 100;
const next  = i => (i + 1) % tracks.length;
const audibleAny = () => tracks.some(t => t.volume > 0.0001);

function stepFromY(y, rect) {
  const rel = 1 - (y - rect.top) / rect.height;       // 0 bottom -> 1 top
  const s   = Math.round(rel * STEPS);
  return clamp(s, 0, STEPS);
}

/* ---- Mixer ---- */
class Mixer {
  constructor() {
    this.active     = 0;
    this.fading     = false;
    this.fadeTo     = 0;
    this.fadeVol    = 1;
    this.fadeStart  = 0;
    this.quietTimer = null;
    this.unlocked   = false;

    this.initAudio();
    this.bindUI();
    requestAnimationFrame(this.raf.bind(this));
  }

  initAudio() {
    tracks.forEach(t => {
      t.loop = true;
      t.volume = 0;
      t.play().catch(()=>{}); // may be blocked until user gesture
    });

    // show default bar state (100%) for first slider
    this.setBar(0, PCT(DEFAULT_STEP));
  }

  unlockAudio() {
    if (this.unlocked) return;
    this.unlocked = true;

    if (overlay) {
      overlay.classList.add("d-none");
      overlay.remove();
    }

    tracks.forEach(t => t.play().catch(()=>{}));
    tracks[0].volume = LEVELS[DEFAULT_STEP];
    this.setBar(0, PCT(DEFAULT_STEP));
  }

  ensureNotSilent() {
    if (audibleAny() || this.fading) return;

    this.active = next(this.active);
    const fromIdx = this.active === 0 ? tracks.length - 1 : this.active - 1;
    const prev = tracks[fromIdx];
    const cur  = tracks[this.active];

    // Wait until metadata is available
    if (!isFinite(prev.duration) || !isFinite(cur.duration)) {
      cur.addEventListener("loadedmetadata", () => this.ensureNotSilent(), { once: true });
      return;
    }

    cur.currentTime = prev.currentTime % cur.duration;
    cur.volume = LEVELS[DEFAULT_STEP];
    this.setBar(this.active, PCT(DEFAULT_STEP));
  }

  setBar(i, percent) {
    fills[i].style.height = `${percent}%`;
  }

  change(idx, step) {
    const volVal = LEVELS[step];
    const volPct = PCT(step);

    if (idx === this.active && !this.fading) {
      tracks[idx].volume = volVal;
      this.setBar(idx, volPct);
      return;
    }
    if (this.fading) return;

    const from = tracks[this.active];
    const to   = tracks[idx];

    if (!isFinite(from.duration) || !isFinite(to.duration)) {
      to.addEventListener("loadedmetadata", () => this.change(idx, step), { once: true });
      return;
    }

    this.fading    = true;
    this.fadeTo    = idx;
    this.fadeVol   = volVal;
    this.fadeStart = performance.now();

    to.currentTime = from.currentTime % to.duration;
    to.volume = 0;
    to.play().catch(()=>{});
    from.volume = volVal;
    this.setBar(this.fadeTo, 0);
  }

  raf(ts) {
    if (this.fading) {
      const d = clamp((ts - this.fadeStart) / XFADE_MS, 0, 1);
      const from = tracks[this.active];
      const to   = tracks[this.fadeTo];

      const vOut = this.fadeVol * (1 - d);
      const vIn  = this.fadeVol * d;

      from.volume = vOut;
      to.volume   = vIn;

      this.setBar(this.active,  vOut * 100);
      this.setBar(this.fadeTo,  vIn  * 100);

      if (d === 1) {
        from.pause();
        from.currentTime = to.currentTime;
        this.active = this.fadeTo;
        this.fading = false;
        this.ensureNotSilent();
      }
    }
    requestAnimationFrame(this.raf.bind(this));
  }

  bindUI() {
    // unlock on first pointer
    document.addEventListener("pointerdown", () => this.unlockAudio(), { once: true });

    sliders.forEach((slider, idx) => {
      slider.style.userSelect  = "none";
      slider.style.touchAction = "none";

      let dragging = false;

      const start = e => {
        e.preventDefault();
        dragging = true;
        move(e);
      };
      const move = e => {
        if (!dragging) return;
        const rect = slider.getBoundingClientRect();
        const y    = e.touches ? e.touches[0].clientY : e.clientY;
        this.change(idx, stepFromY(y, rect));
      };
      const end = () => {
        dragging = false;
        clearTimeout(this.quietTimer);
        this.quietTimer = setTimeout(() => this.ensureNotSilent(), QUIET_DELAY);
      };

      slider.addEventListener("pointerdown", start, { passive: false });
      slider.addEventListener("pointermove", move,  { passive: false });
      window.addEventListener("pointerup",   end,   { passive: true  });
      window.addEventListener("pointercancel", end, { passive: true  });

      slider.addEventListener("contextmenu", e => e.preventDefault());
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new Mixer();
});