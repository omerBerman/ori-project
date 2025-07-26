"use strict";

/**
 * Super-simplified logic:
 * - One active track at a time.
 * - Click on a bar:
 *    • If it's not active → make it active (display 75%, audio volume 1).
 *    • If it's the active bar → drop it to 0 and auto-activate the next bar.
 * - Display is either 75% or 0%. Audio volume is ALWAYS 1 for the active bar.
 * - Try to start automatically; if blocked, first user click will unmute & start.
 */

const DISPLAY_PCT = 75;  // red fill height when active (visual only)
const FULL_VOL    = 1;   // audio volume for active
const ZERO_VOL    = 0;

const sliders = [...document.querySelectorAll(".v-slider")];
const fills   = [...document.querySelectorAll(".slider-fill")];
const tracks  = [...document.querySelectorAll(".track")];

let active = 0;        // index of current active bar
let unlocked = false;  // audio policy handling

function setFill(i, pct) {
  fills[i].style.height = `${pct}%`;
}

function setOnlyActive(idx) {
  // ensure all tracks play (muted might be true until unlock)
  tracks.forEach(t => t.play().catch(()=>{}));

  tracks.forEach((t, i) => {
    if (i === idx) {
      t.volume = FULL_VOL;
      setFill(i, DISPLAY_PCT);
    } else {
      t.volume = ZERO_VOL;
      setFill(i, 0);
    }
  });
  active = idx;
}

/**
 * Switch audio source while keeping "radio-like" sync (enter mid-song).
 */
function syncAndActivate(newIdx) {
  const from = tracks[active];
  const to   = tracks[newIdx];

  const doSwitch = () => {
    if (isFinite(from.duration) && isFinite(to.duration)) {
      to.currentTime = from.currentTime % to.duration;
    }
    setOnlyActive(newIdx);
    // try to unmute after user interaction
    to.muted = false;
  };

  if (!isFinite(to.duration)) {
    to.addEventListener("loadedmetadata", doSwitch, { once: true });
    to.play().catch(()=>{});
  } else {
    doSwitch();
  }
}

/**
 * Try to auto-start at load: unmute first track and play.
 * If browser blocks, first user click will call unlock().
 */
function autoStart() {
  const first = tracks[0];
  first.muted = false;
  setOnlyActive(0);
}
autoStart();

/* Unlock on the first user interaction if needed */
function unlock() {
  if (unlocked) return;
  unlocked = true;
  tracks.forEach(t => {
    t.muted = false;
    t.play().catch(()=>{});
  });
}
document.addEventListener("pointerdown", unlock, { once: true });

/* Click handlers – discrete toggle rules */
sliders.forEach((slider, idx) => {
  const onTap = (e) => {
    e.preventDefault();
    unlock();

    if (idx === active) {
      // same bar: set to 0 and move to next
      const next = (active + 1) % tracks.length;
      // bring current to 0 (display too)
      setFill(active, 0);
      tracks[active].volume = ZERO_VOL;

      syncAndActivate(next);
    } else {
      // activate this bar
      syncAndActivate(idx);
    }
  };

  slider.addEventListener("click", onTap, { passive: false });
  slider.addEventListener("pointerup", onTap, { passive: false });
  slider.addEventListener("touchend", onTap, { passive: false });
});