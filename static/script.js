"use strict";

/* ---- constants ---- */
const STEPS        = 4;
const PCT          = 100 / STEPS;
const DEFAULT_STEP = 3;        // 75%
const XFADE_MS     = 2000;
const QUIET_DELAY  = 300;

/* ---- DOM ---- */
const sliders = [...document.querySelectorAll(".v-slider")];
const fills   = [...document.querySelectorAll(".slider-fill")];
const tracks  = [...document.querySelectorAll(".track")];
const overlay = document.getElementById("unlock");

/* ---- helpers ---- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct   = s => s * PCT;
const next  = i => (i + 1) % tracks.length;
const audibleAny = () => tracks.some(t => t.volume > 0.0001);

function stepFromY(y, rect) {
  const rel = 1 - (y - rect.top) / rect.height;
  return clamp(Math.round(rel * STEPS), 0, STEPS);
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

    this.readyCount = 0; // number of audio tags that are ready

    this.initAudio();
    this.bindUI();
    requestAnimationFrame(this.raf.bind(this));
  }

  initAudio() {
    tracks.forEach(t => {
      t.loop = true;
      t.volume = 0;
      // try play; some browsers block until user gesture
      t.play().catch(()=>{});

      t.addEventListener("loadedmetadata", () => {
        this.readyCount++;
      });
    });

    // Visual default fill
    this.setBar(0, pct(DEFAULT_STEP));
  }

  unlockAudio() {
    if (this.unlocked) return;
    this.unlocked = true;
    if (overlay) {
      overlay.classList.add("d-none");
      overlay.remove();
    }
    tracks.forEach(t => t.play().catch(()=>{}));
    tracks[0].volume = DEFAULT_STEP / STEPS;
    this.setBar(0, pct(DEFAULT_STEP));
  }

  ensureNotSilent() {
    if (audibleAny() || this.fading) return;
    this.active = next(this.active);

    const fromIdx = this.active === 0 ? tracks.length - 1 : this.active - 1;
    const prev = tracks[fromIdx];
    const cur  = tracks[this.active];

    // If metadata not loaded yet, bail out – we'll come back when ready
    if (!isFinite(prev.duration) || !isFinite(cur.duration)) {
      cur.addEventListener("loadedmetadata", () => {
        this.ensureNotSilent();
      }, { once: true });
      return;
    }

    cur.currentTime = prev.currentTime % cur.duration;
    cur.volume = DEFAULT_STEP / STEPS;
    this.setBar(this.active, pct(DEFAULT_STEP));
  }

  setBar(i, percent) {
    fills[i].style.height = `${percent}%`;
  }

  change(idx, step) {
    const volVal = step / STEPS;
    const volPct = pct(step);

    if (idx === this.active && !this.fading) {
      tracks[idx].volume = volVal;
      this.setBar(idx, volPct);
      return;
    }
    if (this.fading) return;

    // ensure audio metadata ready
    const from = tracks[this.active];
    const to   = tracks[idx];

    if (!isFinite(from.duration) || !isFinite(to.duration)) {
      to.addEventListener("loadedmetadata", () => {
        this.change(idx, step);
      }, { once: true });
      return;
    }

    // start fade
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

      this.setBar(this.active,  pct(STEPS) * (vOut / this.fadeVol));
      this.setBar(this.fadeTo, pct(STEPS) * (vIn  / this.fadeVol));

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
        const y = e.touches ? e.touches[0].clientY : e.clientY;
        this.change(idx, stepFromY(y, rect));
      };
      const end = () => {
        dragging = false;
        clearTimeout(this.quietTimer);
        this.quietTimer = setTimeout(() => this.ensureNotSilent(), QUIET_DELAY);
      };

      slider.addEventListener("pointerdown", start, { passive: false });
      slider.addEventListener("pointermove", move,  { passive: false });
      window.addEventListener("pointerup", end,     { passive: true  });
      window.addEventListener("pointercancel", end, { passive: true  });

      slider.addEventListener("contextmenu", e => e.preventDefault());
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new Mixer();
});