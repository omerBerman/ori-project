"use strict";

/**
 * Radio Mixer – mobile-friendly version with:
 * 1) No total silent state (auto-bumps first slider).
 * 2) Smooth drag on mobile (pointer capture, no accidental scroll).
 */

const LEVELS       = [0, 0.35, 0.7, 1];   // volume steps
const STEPS        = LEVELS.length - 1;
const DEFAULT_STEP = 3;                   // start/fallback at 100% (index 3)
const XFADE_MS     = 2000;
const QUIET_DELAY  = 200;

const sliders = [...document.querySelectorAll(".v-slider")];
const fills   = [...document.querySelectorAll(".slider-fill")];
const tracks  = [...document.querySelectorAll(".track")];
const overlay = document.getElementById("unlock");

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PCT   = step => LEVELS[step] * 100;
const next  = i => (i + 1) % tracks.length;
const audibleAny = () => tracks.some(t => t.volume > 0.0001);

function stepFromY(y, rect) {
  const rel = 1 - (y - rect.top) / rect.height;
  return clamp(Math.round(rel * STEPS), 0, STEPS);
}

class Mixer {
  constructor() {
    this.active     = 0;
    this.fading     = false;
    this.fadeTo     = 0;
    this.fadeVol    = 1;
    this.fadeStart  = 0;
    this.quietTimer = null;
    this.unlocked   = false;

    // For hysteresis (avoid “jumping” while dragging)
    this.lastSteps = new Array(sliders.length).fill(-1);

    this.initAudio();
    this.bindUI();
    requestAnimationFrame(this.raf.bind(this));
  }

  initAudio() {
    tracks.forEach(t => {
      t.loop = true;
      t.volume = 0;
      t.play().catch(()=>{});
    });

    // default UI fill
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

    // If absolutely quiet, force slider 0 to default
    this.active = 0;
    const first = tracks[0];
    if (!isFinite(first.duration)) {
      first.addEventListener("loadedmetadata", () => this.ensureNotSilent(), { once: true });
      return;
    }
    first.volume = LEVELS[DEFAULT_STEP];
    this.setBar(0, PCT(DEFAULT_STEP));
  }

  setBar(i, percent) {
    fills[i].style.height = `${percent}%`;
  }

  // Guard: if user tries to mute all bars, auto-bump first
  guardNoSilent(idx, step) {
    const volAfter = LEVELS[step];
    // If user set this slider to 0, check if all others are 0 as well:
    if (volAfter === 0) {
      const othersOn = tracks.some((t, i) => i !== idx && t.volume > 0.0001);
      if (!othersOn) {
        // Force slider 0 to default
        const forcedStep = DEFAULT_STEP;
        tracks[0].volume = LEVELS[forcedStep];
        this.setBar(0, PCT(forcedStep));
        this.active = 0; // we consider channel 0 active if we forced it
      }
    }
  }

  change(idx, step) {
    // Hysteresis: update only if step changed
    if (this.lastSteps[idx] === step) return;
    this.lastSteps[idx] = step;

    this.guardNoSilent(idx, step);

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
    // Unlock audio on first pointer interaction
    document.addEventListener("pointerdown", () => this.unlockAudio(), { once: true });

    sliders.forEach((slider, idx) => {
      slider.style.userSelect  = "none";
      slider.style.touchAction = "none";

      let dragging = false;
      let pointerId = null;

      const start = e => {
        e.preventDefault();
        dragging = true;
        pointerId = e.pointerId || null;
        if (pointerId !== null && slider.setPointerCapture) {
          slider.setPointerCapture(pointerId);
        }
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
        if (pointerId !== null && slider.releasePointerCapture) {
          try { slider.releasePointerCapture(pointerId); } catch(_){}
        }
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