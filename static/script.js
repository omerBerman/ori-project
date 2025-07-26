"use strict";

/**
 * Simplest stable mobile version:
 * - Single <audio id="player"> element.
 * - One station active at a time.
 * - Tap active  -> switch to NEXT station.
 * - Tap other   -> switch to THAT station.
 * - Visual: active bar shows 75%, others 0%.
 * - Audio volume always 1. No crossfade.
 * - "Radio-like": enter mid-song using Date.now() % duration.
 */

const DISPLAY_PCT = 75;

const player  = document.getElementById("player");
const sliders = [...document.querySelectorAll(".v-slider")];
const fills   = [...document.querySelectorAll(".slider-fill")];
const URLS    = Array.isArray(window.TRACK_URLS) ? window.TRACK_URLS : [];

let active    = 0;
let durations = new Array(URLS.length).fill(NaN);
let ready     = false;     // durations loaded
let tryingPlay = false;

const log = (...a) => console.log("[mixer]", ...a);
const err = (...a) => console.error("[mixer]", ...a);

function setFill(i, pct){ fills[i].style.height = `${pct}%`; }
function showOnly(i){ sliders.forEach((_,idx)=> setFill(idx, idx===i?DISPLAY_PCT:0)); }
function nextIdx(i){ return (i + 1) % URLS.length; }

/**
 * Preload metadata to get durations. Fast, small memory footprint.
 * We reuse a single temp Audio element per file.
 */
async function loadDurations(){
  for (let i=0; i<URLS.length; i++){
    durations[i] = await getDuration(URLS[i]);
    log("duration", i, durations[i]);
  }
  ready = true;
}

function getDuration(src){
  return new Promise(resolve=>{
    const a = new Audio();
    a.preload = "metadata";
    a.src = src;
    a.addEventListener("loadedmetadata", () => {
      resolve(isFinite(a.duration) ? a.duration : 0);
    }, { once: true });
    a.addEventListener("error", () => resolve(0), { once: true });
  });
}

function computeOffset(i){
  const dur = durations[i] || 0;
  if (dur <= 0) return 0;
  const off = (Date.now() / 1000) % dur;
  return off;
}

/**
 * Switch the single player to URLS[i], seek to offset, and play.
 * Robust order for iOS:
 *  - set src
 *  - wait loadedmetadata
 *  - set currentTime
 *  - play()
 *  - if play() rejected → wait for first user gesture to retry
 */
async function playStation(i){
  active = i;
  showOnly(i);

  const src = URLS[i];
  player.loop = true;

  // set src (doing this first resets the element)
  player.src = src;

  const offset = computeOffset(i);

  await waitLoaded(player).catch(()=>{});

  // set currentTime; some iOS versions want this after play() too, so do both.
  try { player.currentTime = offset; } catch(_) {}

  // attempt to play
  try {
    tryingPlay = true;
    await player.play();
    tryingPlay = false;
    // ensure seek applied
    try { player.currentTime = offset; } catch(_) {}
  } catch(e){
    tryingPlay = false;
    err("play rejected, will wait for user gesture", e?.message || e);
  }
}

function waitLoaded(aud){
  return new Promise((resolve, reject)=>{
    if (isFinite(aud.duration) && aud.duration > 0) return resolve();
    const onMeta = () => { cleanup(); resolve(); };
    const onErr  = (e) => { cleanup(); reject(e); };
    function cleanup(){
      aud.removeEventListener("loadedmetadata", onMeta);
      aud.removeEventListener("error", onErr);
    }
    aud.addEventListener("loadedmetadata", onMeta, { once: true });
    aud.addEventListener("error", onErr, { once: true });
  });
}

/* user gesture unlock: retry play if needed */
function attachUnlock(){
  const once = async () => {
    if (!ready) await loadDurations().catch(()=>{});
    if (player.paused || player.readyState < 2) {
      await playStation(active);
    }
  };
  document.addEventListener("pointerdown", once, { once:true, capture:true, passive:true });
  document.addEventListener("touchstart", once, { once:true, capture:true, passive:true });
  document.addEventListener("click", once, { once:true, capture:true, passive:true });
}

/* ---- init ---- */
async function init(){
  log("init, urls:", URLS);
  if (!URLS.length) {
    err("no TRACK_URLS");
    return;
  }

  showOnly(0);
  attachUnlock();

  // try preload durations (best-effort)
  loadDurations().catch(()=>{});

  // try to start automatically
  await playStation(0);

  // taps
  sliders.forEach((slider, idx)=>{
    slider.style.touchAction = "manipulation";
    slider.addEventListener("pointerdown", async (e)=>{
      e.preventDefault();

      if (idx === active) {
        await playStation(nextIdx(active));
      } else {
        await playStation(idx);
      }
    }, { passive:false });
  });
}

document.addEventListener("DOMContentLoaded", init);