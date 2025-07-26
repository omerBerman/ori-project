"use strict";

/**
 * Dual-audio simple mixer:
 * - Two HTMLAudioElements (A/B) allow a tiny crossfade to avoid gaps.
 * - Visual bar jumps between 0% and 80%.
 * - Audio volume always 1. We only use fade to mask switch.
 * - Tap active  -> go to NEXT.
 * - Tap other   -> go to THAT one.
 */

const DISPLAY_ACTIVE = 80;      // visual %
const DISPLAY_IDLE   = 0;

const FADE_MS        = 200;     // audio fade time
const GRAPH_MS       = Math.round(FADE_MS * 1.25); // 25% slower visual rise

const URLS    = Array.isArray(window.TRACK_URLS) ? window.TRACK_URLS : [];
const sliders = [...document.querySelectorAll(".v-slider")];
const fills   = [...document.querySelectorAll(".slider-fill")];

const A = document.getElementById("playerA");
const B = document.getElementById("playerB");

let usingA     = true;   // which player is currently active
let activeIdx  = 0;      // which station is active
let durations  = new Array(URLS.length).fill(0);
let fading     = false;

/* ---------- helpers ---------- */
const log  = (...a) => console.log("[mixer]", ...a);
const err  = (...a) => console.error("[mixer]", ...a);
const next = i => (i + 1) % URLS.length;
const clamp01 = v => Math.max(0, Math.min(1, v));

function setFill(i, pct){ fills[i].style.height = `${pct}%`; }
function showOnly(i){ sliders.forEach((_,idx)=> setFill(idx, idx===i?DISPLAY_ACTIVE:DISPLAY_IDLE)); }

function getCurrentPlayer(){ return usingA ? A : B; }
function getIdlePlayer(){ return usingA ? B : A; }

function computeOffset(i){
  const dur = durations[i] || 0;
  if (dur <= 0) return 0;
  return (Date.now() / 1000) % dur;
}

function waitEvent(el, ev, timeoutMs=4000){
  return new Promise((resolve, reject)=>{
    let done = false;
    const onOk = () => { if (done) return; done = true; cleanup(); resolve(); };
    const onErr= () => { if (done) return; done = true; cleanup(); reject(new Error(ev+" error")); };
    const to = setTimeout(() => {
      if (done) return; done = true; cleanup(); reject(new Error("timeout "+ev));
    }, timeoutMs);
    function cleanup(){
      clearTimeout(to);
      el.removeEventListener(ev, onOk);
      el.removeEventListener("error", onErr);
    }
    el.addEventListener(ev, onOk, { once:true });
    el.addEventListener("error", onErr, { once:true });
  });
}

async function getDuration(src){
  return new Promise(resolve=>{
    const a = new Audio();
    a.preload = "metadata";
    a.src = src;
    a.addEventListener("loadedmetadata", ()=>{
      resolve(isFinite(a.duration) ? a.duration : 0);
    }, { once:true });
    a.addEventListener("error", ()=> resolve(0), { once:true });
  });
}

async function preloadDurations(){
  for (let i=0;i<URLS.length;i++){
    durations[i] = await getDuration(URLS[i]);
  }
}

/**
 * Fast switch with tiny crossfade between players.
 * Steps:
 *  - idle.src = target url
 *  - await canplay (faster than full load)
 *  - seek to offset
 *  - play idle at volume 0, then fade in
 *  - fade out current, pause it
 */
async function switchTo(index){
  if (fading) return;
  fading = true;

  const current = getCurrentPlayer();
  const idle    = getIdlePlayer();

  const src    = URLS[index];
  const offset = computeOffset(index);

  // prepare idle
  idle.loop = true;
  idle.volume = 0;
  idle.src = src;

  try {
    await waitEvent(idle, "loadedmetadata", 4000).catch(()=>{});
    // set offset before play (and after as safety)
    try { idle.currentTime = offset; } catch(_){}
    await idle.play().catch(()=>{});
    try { idle.currentTime = offset; } catch(_){}
  } catch(e){
    err("switchTo prepare failed", e);
  }

  // start visual rise to 80%
  animateFillRise(index, DISPLAY_ACTIVE, GRAPH_MS);

  // audio crossfade
  const start = performance.now();
  function step(now){
    const t  = Math.min(1, (now - start)/FADE_MS);
    const vIn  = clamp01(t);
    const vOut = clamp01(1 - t);
    idle.volume    = vIn;
    current.volume = vOut;

    if (t < 1){
      requestAnimationFrame(step);
    } else {
      current.pause();
      usingA = !usingA;     // swap roles
      activeIdx = index;
      fading = false;
      // ensure visuals of others to 0
      sliders.forEach((_,i)=> { if (i!==activeIdx) setFill(i, DISPLAY_IDLE); });
    }
  }
  requestAnimationFrame(step);
}

/* animate bar fill up to targetPct over ms */
function animateFillRise(i, targetPct, ms){
  const startPct = parseFloat(fills[i].style.height) || 0;
  const start    = performance.now();
  function loop(now){
    const t = Math.min(1, (now - start)/ms);
    const pct = startPct + (targetPct - startPct)*t;
    setFill(i, pct);
    if (t < 1) requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

/* ---------- init ---------- */
async function init(){
  log("init urls:", URLS);
  if (!URLS.length) {
    err("no TRACK_URLS");
    return;
  }

  showOnly(0);
  preloadDurations(); // best-effort, not blocking

  // try to start station 0 quickly
  usingA   = true;
  activeIdx= 0;

  // set initial src on A, try to play
  const src0    = URLS[0];
  const offset0 = 0; // allow immediate start; we'll seek after play for stability
  A.src = src0;
  try {
    await A.play();
    try { A.currentTime = computeOffset(0); } catch(_){}
    A.volume = 1;
    animateFillRise(0, DISPLAY_ACTIVE, GRAPH_MS);
  } catch(e){
    err("autoplay rejected; will start on first tap", e?.message || e);
  }

  // unlock handlers: if user taps and nothing plays, start current
  const unlock = async () => {
    if (!A.currentTime && A.paused) {
      try {
        await A.play();
        try { A.currentTime = computeOffset(0); } catch(_){}
        A.volume = 1;
        animateFillRise(0, DISPLAY_ACTIVE, GRAPH_MS);
      } catch(e){ err("unlock play failed", e); }
    }
  };
  document.addEventListener("pointerdown", unlock, { once:true, capture:true, passive:true });
  document.addEventListener("touchstart", unlock, { once:true, capture:true, passive:true });
  document.addEventListener("click", unlock, { once:true, capture:true, passive:true });

  // taps on sliders
  sliders.forEach((slider, idx)=>{
    slider.addEventListener("pointerdown", async (e)=>{
      e.preventDefault();
      if (idx === activeIdx) {
        await switchTo(next(activeIdx));
      } else {
        await switchTo(idx);
      }
    }, { passive:false });
  });
}

document.addEventListener("DOMContentLoaded", init);