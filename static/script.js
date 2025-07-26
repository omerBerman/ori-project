"use strict";

/**
 * Single <audio> + radio clock + one-time start overlay.
 * Logic unchanged. Visual bars:
 * - 80% active (aligned to the 4th inner line).
 * - Per-direction speeds (rise vs fall).
 */

const DISPLAY_ACTIVE = 80;  // must be exactly 80 to hit the 4th line
const DISPLAY_IDLE   = 0;

/* audio dip timings */
const DIP_MS   = 180;
const DOWN_MS  = Math.round(DIP_MS / 2);
const UP_MS    = DIP_MS - DOWN_MS;

/* bar visual speeds (edit these) */
const RISE_MS  = 240;  // fill grows to 80%
const FALL_MS  = 300;  // fill shrinks to 0% (slower)

/* elements */
const player   = document.getElementById("player");
const startBtn = document.getElementById("startOverlay");
const sliders  = [...document.querySelectorAll(".v-slider")];
const fills    = [...document.querySelectorAll(".slider-fill")];
const URLS     = Array.isArray(window.TRACK_URLS) ? window.TRACK_URLS : [];

/* state */
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

/* ===== durations ===== */
function getDuration(src){
  return new Promise(resolve=>{
    const a = new Audio();
    a.preload = "metadata";
    a.src = src;
    a.addEventListener("loadedmetadata", ()=> resolve(isFinite(a.duration) ? a.duration : 0), { once:true });
    a.addEventListener("error", ()=> resolve(0), { once:true });
  });
}
async function preloadDurations(){
  for (let i=0;i<URLS.length;i++){
    durations[i] = await getDuration(URLS[i]).catch(()=>0);
  }
}

/* ===== radio offset ===== */
function computeOffsetSeconds(i){
  const dur = durations[i] || 0;
  if (dur <= 0) return 0;
  const elapsed = (Date.now() - radioEpoch) / 1000;
  return elapsed % dur;
}

/* ===== waits ===== */
function waitEvent(el, ev, timeoutMs=5000){
  return new Promise((resolve, reject)=>{
    let done=false;
    const ok = ()=>{ if(done) return; done=true; cleanup(); resolve(); };
    const bad= ()=>{ if(done) return; done=true; cleanup(); reject(new Error(ev+" error")); };
    const to = setTimeout(()=>{ if(done) return; done=true; cleanup(); reject(new Error("timeout "+ev)); }, timeoutMs);
    function cleanup(){
      clearTimeout(to);
      el.removeEventListener(ev, ok);
      el.removeEventListener("error", bad);
    }
    el.addEventListener(ev, ok,  { once:true });
    el.addEventListener("error", bad, { once:true });
  });
}

/* ===== bar visuals ===== */
function getPct(i){
  const v = parseFloat(fills[i].style.height);
  return isFinite(v) ? v : 0;
}

function setBarWithSpeed(i, targetPct){
  const prev = getPct(i);
  const isRising = targetPct > prev;
  const dur = isRising ? RISE_MS : FALL_MS;
  const el = fills[i];
  el.style.transition = `height ${dur}ms linear`;
  el.style.height = `${targetPct}%`;
}

function updateFills(targetIdx){
  for (let i=0;i<fills.length;i++){
    const pct = (i === targetIdx) ? DISPLAY_ACTIVE : DISPLAY_IDLE;
    setBarWithSpeed(i, pct);
  }
}

/* ===== audio dip ===== */
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

/* ===== core switch ===== */
async function switchTo(index){
  if (switching) return;
  const t = nowMs();
  if (t < tapLockMs) return;
  tapLockMs = t + DIP_MS + 120;

  switching = true;

  /* animate bars to new target */
  updateFills(index);

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

/* ===== start ===== */
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
    updateFills(0);
  } catch(e){
    err("startPlayback play failed:", e);
  }

  startBtn.style.display = "none";
}

/* ===== init ===== */
function init(){
  if (!URLS.length) {
    err("no TRACK_URLS");
    return;
  }

  /* initial visuals */
  for (let i=0;i<fills.length;i++) fills[i].style.height = "0%";
  updateFills(0);

  /* overlay start */
  startBtn.addEventListener("click", startPlayback, { passive: true });

  /* allow any first tap to start */
  const startOnce = () => startPlayback();
  document.addEventListener("pointerdown", startOnce, { once:true, capture:true, passive:true });
  document.addEventListener("touchstart", startOnce,  { once:true, capture:true, passive:true });
  document.addEventListener("click", startOnce,       { once:true, capture:true, passive:true });

  /* slider taps */
  sliders.forEach((slider, idx)=>{
    slider.addEventListener("pointerdown", async (e)=>{
      e.preventDefault();
      if (!started) return;
      if (idx === activeIdx) await switchTo(next(activeIdx));
      else                   await switchTo(idx);
    }, { passive:false });
  });
}

document.addEventListener("DOMContentLoaded", init);