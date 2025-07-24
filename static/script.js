"use strict";

/**
 * Radio Mixer – mobile friendly.
 * 1) No full-silent state: if all sliders are 0, we ramp track 0 up smoothly.
 * 2) Smooth drag via pointer capture; no scroll interference during drag.
 * 3) Autoplay: audio starts muted, then we ramp volume up. No "tap to start" overlay.
 */

const LEVELS       = [0, 0.35, 0.7, 1];   // volume steps
const STEPS        = LEVELS.length - 1;
const DEFAULT_STEP = 3;                   // index => 100%
const XFADE_MS     = 2000;                // crossfade duration
const RAMP_MS      = 400;                 // ramp for auto-unmute or anti-silence
const QUIET_DELAY  = 200;                 // ms before fallback after silence check

const sliders = [...document.querySelectorAll(".v-slider")];
const fills   = [...document.querySelectorAll(".slider-fill")];
const tracks  = [...document.querySelectorAll(".track")];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PCT   = step => LEVELS[step] * 100;
const next  = i => (i + 1) % tracks.length;
const audibleAny = () => tracks.some(t => t.volume > 0.0001);

/**
 * Pointer/touch Y → step index (0..STEPS).
 */
function stepFromY(y, rect) {
  const rel = 1 - (y - rect.top) / rect.height;
  return clamp(Math.round(rel * STEPS), 0, STEPS);
}

/**
 * Ramp a track and bar from current volume to target volume over duration.
 */
function rampVolume(track, barIdx, targetVol, duration = RAMP_MS, onComplete = () => {}) {
  const startVol  = track.volume;
  const startPct  = startVol * 100;
  const targetPct = targetVol * 100;
  const startTime = performance.now();

  function loop(now) {
    const t  = clamp((now - startTime) / duration, 0, 1);
    const v  = startVol + (targetVol - startVol) * t;
    const pc = startPct + (targetPct - startPct) * t;

    track.volume = v;
    fills[barIdx].style.height = `${pc}%`;

    if (t < 1) requestAnimationFrame(loop);
    else onComplete();
  }
  requestAnimationFrame(loop);
}

class Mixer {
  constructor() {
    this.active     = 0;
    this.fading     = false;
    this.fadeTo     = 0;
    this.fadeVol    = 1;
    this.fadeStart  = 0;
    this.quietTimer = null;

    this.lastSteps  = new Array(sliders.length).fill(-1);

    this.initAudio();
    this.bindUI();
    this.tryAutoStart();
    requestAnimationFrame(this.raf.bind(this));
  }

  initAudio() {
    tracks.forEach(t => {
      t.loop   = true;
      t.volume = 0;
      t.play().catch(()=>{});
    });
    this.setBar(0, PCT(DEFAULT_STEP));  // UI fill, real vol changes after ramp
  }

  tryAutoStart() {
    const first = tracks[0];
    first.muted = false;
    rampVolume(first, 0, LEVELS[DEFAULT_STEP], RAMP_MS, () => {
      this.active = 0;
    });
  }

  ensureNotSilent() {
    if (audibleAny() || this.fading) return;

    const first = tracks[0];
    if (!isFinite(first.duration)) {
      first.addEventListener("loadedmetadata", () => this.ensureNotSilent(), { once: true });
      return;
    }
    this.active = 0;
    rampVolume(first, 0, LEVELS[DEFAULT_STEP], RAMP_MS);
  }

  setBar(i, percent) {
    fills[i].style.height = `${percent}%`;
  }

  guardNoSilent(idx, step) {
    const newVol = LEVELS[step];
    if (newVol > 0) return;

    const othersOn = tracks.some((t, i) => i !== idx && t.volume > 0.0001);
    if (!othersOn) {
      const first = tracks[0];
      rampVolume(first, 0, LEVELS[DEFAULT_STEP], RAMP_MS);
      this.active = 0;
    }
  }

  change(idx, step) {
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
      const d    = clamp((ts - this.fadeStart) / XFADE_MS, 0, 1);
      const from = tracks[this.active];
      const to   = tracks[this.fadeTo];

      const vOut = this.fadeVol * (1 - d);
      const vIn  = this.fadeVol * d;

      from.volume = vOut;
      to.volume   = vIn;

      this.setBar(this.active, vOut * 100);
      this.setBar(this.fadeTo, vIn  * 100);

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
    sliders.forEach((slider, idx) => {
      slider.style.userSelect  = "none";
      slider.style.touchAction = "none";

      let dragging  = false;
      let pointerId = null;

      const start = e => {
        e.preventDefault();
        dragging  = true;
        pointerId = e.pointerId ?? null;
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
          try { slider.releasePointerCapture(pointerId); } catch (_) {}
        }
        clearTimeout(this.quietTimer);
        this.quietTimer = setTimeout(() => this.ensureNotSilent(), QUIET_DELAY);
      };

      slider.addEventListener("pointerdown", start,  { passive: false });
      slider.addEventListener("pointermove", move,   { passive: false });
      window.addEventListener("pointerup",   end,    { passive: true  });
      window.addEventListener("pointercancel", end,  { passive: true  });
      slider.addEventListener("contextmenu", e => e.preventDefault());
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new Mixer();
});