"use strict";

/* ───── visuals timing ─────
   new bar rises fast, old bar falls slow */
const DISPLAY_ACTIVE = 80;
const DISPLAY_IDLE   = 0;

const DIP_MS   = 180;                  // audio dip/canplay/ramp (כמו קודם)
const DOWN_MS  = Math.round(DIP_MS/2);
const UP_MS    = DIP_MS - DOWN_MS;

const RISE_MS  = 160;                  // new bar fill (מהר)
const FALL_MS  = 420;                  // old bar fall (איטי ≈60% איטי יותר)

/* elements & data */
const player   = document.getElementById("player");
const startBtn = document.getElementById("startOverlay");
const sliders  = [...document.querySelectorAll(".v-slider")];
const fills    = [...document.querySelectorAll(".slider-fill")];
const URLS     = Array.isArray(window.TRACK_URLS) ? window.TRACK_URLS : [];

let activeIdx  = 0;
let durations  = new Array(URLS.length).fill(0);
let radioEpoch = Date.now();
let switching  = false;
let tapLockMs  = 0;
let started    = false;

/* utils */
const log = (...a)=>console.log("[mixer]", ...a);
const err = (...a)=>console.error("[mixer]", ...a);
const clamp01 = v => Math.max(0, Math.min(1, v));
const nextIdx = i => (i + 1) % URLS.length;
const nowMs   = () => performance.now();

function setFill(i, pct){ if (fills[i]) fills[i].style.height = `${pct}%`; }
function showOnly(i){ sliders.forEach((_,idx)=> setFill(idx, idx===i?DISPLAY_ACTIVE:DISPLAY_IDLE)); }

/* durations */
function getDuration(src){
  return new Promise(resolve=>{
    const a = new Audio();
    a.preload = "metadata";
    a.src = src;
    a.addEventListener("loadedmetadata", ()=> resolve(isFinite(a.duration)?a.duration:0), { once:true });
    a.addEventListener("error", ()=> resolve(0), { once:true });
  });
}
async function preloadDurations(){
  for (let i=0;i<URLS.length;i++){
    durations[i] = await getDuration(URLS[i]).catch(()=>0);
  }
}
function computeOffsetSeconds(i){
  const dur = durations[i] || 0;
  if (dur <= 0) return 0;
  const elapsed = (Date.now() - radioEpoch) / 1000;
  return elapsed % dur;
}

/* waits */
function waitEvent(el, ev, timeoutMs=5000){
  return new Promise((resolve, reject)=>{
    let done=false;
    const ok=()=>{ if(done) return; done=true; cleanup(); resolve(); };
    const bad=()=>{ if(done) return; done=true; cleanup(); reject(new Error(ev+" error")); };
    const to=setTimeout(()=>{ if(done) return; done=true; cleanup(); reject(new Error("timeout "+ev)); }, timeoutMs);
    function cleanup(){
      clearTimeout(to);
      el.removeEventListener(ev, ok);
      el.removeEventListener("error", bad);
    }
    el.addEventListener(ev, ok,  { once:true });
    el.addEventListener("error", bad, { once:true });
  });
}

/* animations */
function animateTo(i, targetPct, ms){
  const startPct = parseFloat(fills[i].style.height) || 0;
  const t0 = nowMs();
  function loop(t){
    const k = Math.min(1, (t - t0)/ms);
    const pct = startPct + (targetPct - startPct)*k;
    setFill(i, pct);
    if (k < 1) requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

async function dipDown(to=0.02, ms=DOWN_MS){
  return new Promise(res=>{
    const startVol = player.volume || 1;
    const t0 = nowMs();
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
  const t0 = nowMs();
  function step(t){
    const k = Math.min(1, (t - t0)/ms);
    const v = startVol + (to - startVol)*k;
    player.volume = clamp01(v);
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* switch */
async function switchTo(index){
  if (switching) return;
  const t = nowMs();
  if (t < tapLockMs) return;
  tapLockMs = t + DIP_MS + 120;

  switching = true;

  // visual: old falls slow, new rises fast
  const oldIdx = activeIdx;
  if (oldIdx !== index) animateTo(oldIdx, DISPLAY_IDLE, FALL_MS);
  animateTo(index, DISPLAY_ACTIVE, RISE_MS);

  const src    = URLS[index];
  const offset = computeOffsetSeconds(index);

  try {
    await dipDown(0.02, DOWN_MS);

    player.src = src;
    player.load();
    await waitEvent(player, "canplay", 5000).catch(()=>{});
    try { player.currentTime = offset; } catch(_){}
    await player.play().catch(()=>{});
    try { player.currentTime = offset; } catch(_){}

    rampUp(1, UP_MS);
    activeIdx = index;
  } catch(e){
    err("switchTo failed:", e);
  } finally {
    switching = false;
  }
}

/* start flow */
async function startPlayback(){
  if (started) return;
  started = true;

  await preloadDurations().catch(()=>{});

  try {
    player.src = URLS[0];
    player.loop = true;
    await waitEvent(player, "canplay", 5000).catch(()=>{});
    try { player.currentTime = computeOffsetSeconds(0); } catch(_){}
    await player.play();
    try { player.currentTime = computeOffsetSeconds(0); } catch(_){}
    player.volume = 1;
    showOnly(0);
    // לוודא שהמילוי מתחיל ב־80%
    animateTo(0, DISPLAY_ACTIVE, RISE_MS);
  } catch(e){
    err("startPlayback play failed:", e);
  }

  startBtn.style.display = "none";
}

/* init */
function init(){
  if (!URLS.length) { err("no TRACK_URLS"); return; }

  showOnly(0);

  startBtn.addEventListener("click", startPlayback, { passive:true });

  const startOnce = () => startPlayback();
  document.addEventListener("pointerdown", startOnce, { once:true, capture:true, passive:true });
  document.addEventListener("touchstart", startOnce,  { once:true, capture:true, passive:true });
  document.addEventListener("click", startOnce,       { once:true, capture:true, passive:true });

  sliders.forEach((slider, idx)=>{
    slider.addEventListener("pointerdown", async (e)=>{
      e.preventDefault();
      if (!started) return;
      if (idx === activeIdx) {
        await switchTo(nextIdx(activeIdx));
      } else {
        await switchTo(idx);
      }
    }, { passive:false });
  });
}

document.addEventListener("DOMContentLoaded", init);