"use strict";

/**
 * Single <audio> with a "radio clock".
 * - One player only.
 * - Tap active -> switch to NEXT station.
 * - Tap other  -> switch to THAT station.
 * - Volume is always 1 during playback.
 * - Switch uses a short dip with canplay readiness to avoid gaps.
 * - Visual bar: 0% or 80%. UI rise is 25% slower than audio dip.
 */

const DISPLAY_ACTIVE = 80;          // visual percent when active
const DISPLAY_IDLE   = 0;
const DIP_MS         = 180;         // total dip time (down+up ≈ 180ms)
const DOWN_MS        = Math.round(DIP_MS / 2);
const UP_MS          = DIP_MS - DOWN_MS;
const GRAPH_MS       = Math.round(DIP_MS * 1.25);  // 25% slower UI

const player  = document.getElementById("player");
const sliders = [...document.querySelectorAll(".v-slider")];
const fills   = [...document.querySelectorAll(".slider-fill")];
const URLS    = Array.isArray(window.TRACK_URLS) ? window.TRACK_URLS : [];

let activeIdx   = 0;
let durations   = new Array(URLS.length).fill(0);
let radioEpoch  = Date.now();  // base clock for "radio" sync
let switching   = false;
let unlocked    = false;
let tapLockMs   = 0;           // debounce taps during switch

const log = (...a)=>console.log("[mixer]", ...a);
const err = (...a)=>console.error("[mixer]", ...a);

function setFill(i, pct){ if (fills[i]) fills[i].style.height = `${pct}%`; }
function showOnly(i){ sliders.forEach((_,idx)=> setFill(idx, idx===i ? DISPLAY_ACTIVE : DISPLAY_IDLE)); }
function nextIdx(i){ return (i + 1) % URLS.length; }
const clamp01 = v => Math.max(0, Math.min(1, v));

function now(){ return performance.now(); }

/* ---------- durations ---------- */
function getDuration(src){
  return new Promise(resolve=>{
    const a = new Audio();
    a.preload = "metadata";
    a.src = src;
    a.addEventListener("loadedmetadata", ()=> resolve(isFinite(a.duration) ? a.duration : 0), { once: true });
    a.addEventListener("error", ()=> resolve(0), { once: true });
  });
}
async function preloadDurations(){
  for (let i=0;i<URLS.length;i++){
    durations[i] = await getDuration(URLS[i]);
    log("duration", i, durations[i].toFixed(2));
  }
}

/* ---------- offsets ---------- */
function computeOffsetSeconds(i){
  const dur = durations[i] || 0;
  if (dur <= 0) return 0;
  const elapsed = (Date.now() - radioEpoch) / 1000;
  return elapsed % dur;
}

/* ---------- waits ---------- */
function waitEvent(el, ev, timeoutMs=5000){
  return new Promise((resolve, reject)=>{
    let done = false;
    const ok  = ()=>{ if(done) return; done=true; cleanup(); resolve(); };
    const bad = ()=>{ if(done) return; done=true; cleanup(); reject(new Error(ev+" error")); };
    const to  = setTimeout(()=>{ if(done) return; done=true; cleanup(); reject(new Error("timeout "+ev)); }, timeoutMs);
    function cleanup(){
      clearTimeout(to);
      el.removeEventListener(ev, ok);
      el.removeEventListener("error", bad);
    }
    el.addEventListener(ev, ok,  { once:true });
    el.addEventListener("error", bad, { once:true });
  });
}

/* ---------- visuals ---------- */
function animateFillRise(i, target, ms){
  const startPct = parseFloat(fills[i].style.height) || 0;
  const t0 = now();
  function loop(t){
    const k = Math.min(1, (t - t0)/ms);
    const pct = startPct + (target - startPct)*k;
    setFill(i, pct);
    if (k < 1) requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

/* ---------- volume dip ---------- */
async function dipDown(to=0.02, ms=DOWN_MS){
  return new Promise(res=>{
    const startVol = player.volume || 1;
    const t0 = now();
    function step(t){
      const k = Math.min(1, (t - t0)/ms);
      const v = startVol + (to - startVol)*k;
      player.volume = clamp01(v);
      if (k < 1) requestAnimationFrame(step); else res();
    }
    requestAnimationFrame(step);
  });
}
function rampUp(to=1, ms=UP_MS){
  const startVol = player.volume || 0.02;
  const t0 = now();
  function step(t){
    const k = Math.min(1, (t - t0)/ms);
    const v = startVol + (to - startVol)*k;
    player.volume = clamp01(v);
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ---------- core switch using canplay ---------- */
async function switchTo(index){
  if (switching) return;
  const nowMs = performance.now();
  if (nowMs < tapLockMs) return;   // debounce
  tapLockMs = nowMs + DIP_MS + 80;

  switching = true;
  showOnly(index);
  animateFillRise(index, DISPLAY_ACTIVE, GRAPH_MS);

  const src    = URLS[index];
  const offset = computeOffsetSeconds(index);

  try {
    // dip quickly
    await dipDown(0.02, DOWN_MS);

    // swap src and load enough to play seamlessly
    player.src = src;
    player.load();
    await waitEvent(player, "canplay", 5000).catch(()=>{}); // stronger than loadedmetadata

    try { player.currentTime = offset; } catch(_){}
    await player.play().catch(()=>{});
    try { player.currentTime = offset; } catch(_){}

    // back up
    rampUp(1, UP_MS);
    activeIdx = index;
  } catch(e){
    err("switchTo failed", e);
  } finally {
    switching = false;
  }
}

/* ---------- unlock ---------- */
function attachUnlock(){
  const once = async () => {
    if (unlocked) return;
    unlocked = true;
    try { await player.play(); } catch(_) {}
  };
  const opts = { once:true, capture:true, passive:true };
  document.addEventListener("pointerdown", once, opts);
  document.addEventListener("touchstart", once,  opts);
  document.addEventListener("click", once,       opts);
}

/* ---------- init ---------- */
async function init(){
  log("init", URLS);
  if (!URLS.length) {
    err("no TRACK_URLS – nothing to play");
    return;
  }

  showOnly(0);
  attachUnlock();
  preloadDurations().catch(()=>{});

  // try start station 0
  try {
    player.src = URLS[0];
    player.loop = true;
    await waitEvent(player, "canplay", 5000).catch(()=>{});
    try { player.currentTime = computeOffsetSeconds(0); } catch(_){}
    await player.play().catch(()=>{});
    try { player.currentTime = computeOffsetSeconds(0); } catch(_){}
    player.volume = 1;
    animateFillRise(0, DISPLAY_ACTIVE, GRAPH_MS);
  } catch(e){
    err("autoplay failed; will start on first tap", e?.message || e);
  }

  // taps
  sliders.forEach((slider, idx)=>{
    slider.style.touchAction = "manipulation";
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