"use strict";

/**
 * Tap-only mixer:
 * - One active track at a time.
 * - Tap active bar  -> switch to NEXT bar.
 * - Tap other bar   -> switch to THAT bar.
 * - Visual is 75%, audio volume is 1.0.
 */

const DISPLAY_PCT = 75;
const FULL_VOL    = 1;
const ZERO_VOL    = 0;
const XFADE_MS    = 300;

const sliders = [...document.querySelectorAll(".v-slider")];
const fills   = [...document.querySelectorAll(".slider-fill")];
const tracks  = [...document.querySelectorAll(".track")];

let active   = 0;
let busy     = false;
let unlocked = false;

const clamp01 = v => Math.max(0, Math.min(1, v));

function nextIndex(i) {
  return (i + 1) % tracks.length;
}

function setFill(i, pct) {
  fills[i].style.height = `${pct}%`;
}

function showOnly(iTarget) {
  sliders.forEach((_, i) => setFill(i, i === iTarget ? DISPLAY_PCT : 0));
}

function setVolumesInstant(iTarget) {
  tracks.forEach((t, i) => {
    t.volume = clamp01(i === iTarget ? FULL_VOL : ZERO_VOL);
  });
}

function ensurePlayAll() {
  tracks.forEach(t => t.play().catch(()=>{}));
}

function unlock() {
  if (unlocked) return;
  unlocked = true;
  tracks.forEach(t => {
    t.muted = false;
    t.play().catch(()=>{});
  });
}

function syncTimes(from, to) {
  if (isFinite(from.duration) && isFinite(to.duration)) {
    to.currentTime = from.currentTime % to.duration;
  }
}

/** quick crossfade; if target==active -> just ensure states */
function crossfadeTo(targetIdx) {
  if (busy) return;

  if (targetIdx === active) {
    // nothing to fade; just enforce states
    showOnly(active);
    setVolumesInstant(active);
    return;
  }

  busy = true;
  ensurePlayAll();

  const fromIdx = active;
  const toIdx   = targetIdx;

  const from = tracks[fromIdx];
  const to   = tracks[toIdx];

  const doFade = () => {
    syncTimes(from, to);
    to.muted = false;
    to.volume = 0;
    to.play().catch(()=>{});
    showOnly(toIdx);

    const start = performance.now();

    function step(now) {
      const t  = (now - start) / XFADE_MS;
      const tc = clamp01(t);
      const vOut = clamp01((1 - tc) * FULL_VOL);
      const vIn  = clamp01(tc * FULL_VOL);

      from.volume = vOut;
      to.volume   = vIn;

      if (tc < 1) {
        requestAnimationFrame(step);
      } else {
        from.pause();
        from.currentTime = to.currentTime;
        active = toIdx;
        busy = false;
      }
    }
    requestAnimationFrame(step);
  };

  if (!isFinite(to.duration) || !isFinite(from.duration)) {
    const once = () => {
      to.removeEventListener("loadedmetadata", once);
      from.removeEventListener("loadedmetadata", once);
      doFade();
    };
    to.addEventListener("loadedmetadata", once, { once: true });
    from.addEventListener("loadedmetadata", once, { once: true });
    to.play().catch(()=>{});
  } else {
    doFade();
  }
}

function init() {
  tracks.forEach(t => {
    t.loop = true;
    t.volume = 0;
    t.play().catch(()=>{});
  });

  // visual + audio default: station 0
  showOnly(0);
  setVolumesInstant(0);
  const first = tracks[0];
  first.muted = false;
  first.play().catch(()=>{});

  sliders.forEach((slider, idx) => {
    slider.style.touchAction = "manipulation";
    slider.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      unlock();
      if (busy) return;

      if (idx === active) {
        crossfadeTo(nextIndex(active));   // tapping active -> next
      } else {
        crossfadeTo(idx);                 // tapping other -> that one
      }
    }, { passive: false });
  });
}

document.addEventListener("DOMContentLoaded", init);