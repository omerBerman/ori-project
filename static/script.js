"use strict";

/**
 * Tap-only logic:
 * - One active track at a time.
 * - Tap active bar  -> switch to NEXT bar (crossfade).
 * - Tap other bar   -> switch to THAT bar (crossfade).
 * - Visual fill is 75%, audio volume is FULL (1.0).
 * - Single event: pointerdown (prevents double firing).
 */

const DISPLAY_PCT = 75;   // red fill height (visual)
const FULL_VOL    = 1;
const ZERO_VOL    = 0;
const XFADE_MS    = 300;  // quick, smooth crossfade

const sliders = [...document.querySelectorAll(".v-slider")];
const fills   = [...document.querySelectorAll(".slider-fill")];
const tracks  = [...document.querySelectorAll(".track")];

let active   = 0;
let busy     = false;     // guard during crossfade
let unlocked = false;

/* ---------- helpers ---------- */

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
  tracks.forEach((t, i) => (t.volume = i === iTarget ? FULL_VOL : ZERO_VOL));
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

/* keep radio-style sync: jump into the same point */
function syncTimes(from, to) {
  if (isFinite(from.duration) && isFinite(to.duration)) {
    to.currentTime = from.currentTime % to.duration;
  }
}

/* quick crossfade between current active and target */
function crossfadeTo(targetIdx) {
  if (busy) return;
  busy = true;

  ensurePlayAll();

  const fromIdx = active;
  const toIdx   = targetIdx;

  const from = tracks[fromIdx];
  const to   = tracks[toIdx];

  // if metadata not ready, wait once then try again
  if (!isFinite(to.duration) || !isFinite(from.duration)) {
    const onLoaded = () => {
      to.removeEventListener("loadedmetadata", onLoaded);
      from.removeEventListener("loadedmetadata", onLoaded);
      crossfadeTo(targetIdx);
    };
    to.addEventListener("loadedmetadata", onLoaded, { once: true });
    from.addEventListener("loadedmetadata", onLoaded, { once: true });
    to.play().catch(()=>{});
    return;
  }

  syncTimes(from, to);
  to.muted = false;
  to.volume = 0;
  to.play().catch(()=>{});

  // update visuals immediately
  showOnly(toIdx);

  const start = performance.now();

  function step(now) {
    const t = Math.min(1, (now - start) / XFADE_MS);
    const vOut = (1 - t) * FULL_VOL;
    const vIn  = t * FULL_VOL;

    from.volume = vOut;
    to.volume   = vIn;

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      from.pause();
      // keep sync linkage
      from.currentTime = to.currentTime;
      active = toIdx;
      busy = false;
    }
  }
  requestAnimationFrame(step);
}

/* ---------- bootstrap ---------- */

function init() {
  // start all tracks muted, then unmute first gradually
  tracks.forEach(t => {
    t.loop = true;
    t.volume = 0;
    t.play().catch(()=>{});
  });

  // visual default
  showOnly(0);

  // try autoplay (some browsers allow). first user tap will call unlock() if needed.
  const first = tracks[0];
  first.muted = false;
  first.play().catch(()=>{});
  crossfadeTo(0); // quick ramp to make sure we end with active=0

  // single event per bar
  sliders.forEach((slider, idx) => {
    slider.style.touchAction = "manipulation";
    slider.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      unlock();

      if (busy) return;

      if (idx === active) {
        // tap active => move to next
        crossfadeTo(nextIndex(active));
      } else {
        // tap other => activate that specific bar
        crossfadeTo(idx);
      }
    }, { passive: false });
  });
}

document.addEventListener("DOMContentLoaded", init);