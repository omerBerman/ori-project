"use strict";

/**
 * WebAudio mixer – robust mobile start.
 * - One active track at a time.
 * - Tap active  => next.
 * - Tap other   => that one.
 * - Visual 75% vs 0%.
 * - Strong resume on first user gesture (pointerdown/touchstart/click).
 * - Verbose console logs for debugging on mobile.
 */

const DISPLAY_PCT = 75;
const FADE_MS     = 300;

const sliders = [...document.querySelectorAll(".v-slider")];
const fills   = [...document.querySelectorAll(".slider-fill")];
const urls    = Array.isArray(window.TRACK_URLS) ? window.TRACK_URLS : [];

let ctx           = null;
let gains         = [];
let buffers       = [];
let sources       = [];
let active        = 0;
let fading        = false;
let started       = false;   // sources created & started
let resumed       = false;   // AudioContext is running
let fadeStartMs   = 0;

const log = (...a) => console.log("[mixer]", ...a);
const err = (...a) => console.error("[mixer]", ...a);

const clamp01 = v => Math.max(0, Math.min(1, v));
const nextIdx = i => (i + 1) % urls.length;

function setFill(i, pct){ fills[i].style.height = `${pct}%`; }
function showOnly(i){ sliders.forEach((_,idx)=> setFill(idx, idx===i?DISPLAY_PCT:0)); }

function computeOffsetSeconds(duration){
  if (!isFinite(duration) || duration <= 0) return 0;
  return (Date.now() / 1000) % duration;
}

function startSourceFor(i){
  const src = ctx.createBufferSource();
  src.buffer = buffers[i];
  src.loop   = true;

  const g = gains[i] || ctx.createGain();
  g.gain.value = (i === active) ? 1 : 0;
  src.connect(g).connect(ctx.destination);

  const offset = computeOffsetSeconds(buffers[i].duration);
  src.start(0, offset);

  sources[i] = src;
}

function buildGraph(){
  if (started) return;
  log("buildGraph: creating gains & sources");
  gains = urls.map(()=> ctx.createGain());
  gains.forEach((g,i)=> g.gain.value = (i===active?1:0));
  sources = new Array(urls.length);
  for (let i=0; i<urls.length; i++){
    startSourceFor(i);
  }
  started = true;
}

async function loadAllBuffers(){
  const out = [];
  for (const u of urls){
    log("fetch", u);
    const res = await fetch(u, { cache: "force-cache" });
    if (!res.ok) throw new Error(`fetch failed ${u} status=${res.status}`);
    const ab  = await res.arrayBuffer();
    const buf = await ctx.decodeAudioData(ab);
    out.push(buf);
  }
  return out;
}

async function ensureContext(){
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    log("AudioContext created, state:", ctx.state);
  }
  if (ctx.state !== "running") {
    try {
      await ctx.resume();
      log("AudioContext resumed:", ctx.state);
    } catch(e){
      err("resume failed", e);
    }
  }
  resumed = (ctx.state === "running");
  return resumed;
}

async function ensureBuffers(){
  if (buffers.length === 0) {
    log("decoding buffers…");
    buffers = await loadAllBuffers();
    log("buffers decoded:", buffers.map(b=>b.duration.toFixed(2)));
  }
}

async function ensureGraph(){
  await ensureContext();
  await ensureBuffers();
  buildGraph();
}

function crossfadeTo(target){
  if (fading) return;
  if (target === active) { showOnly(target); return; }
  if (!resumed || !started) {
    // will be re-called after resume/graph
    ensureGraph().then(()=> crossfadeTo(target)).catch(err);
    return;
  }

  fading = true;
  showOnly(target);

  const from = active;
  const to   = target;

  const gFrom = gains[from];
  const gTo   = gains[to];

  const start = ctx.currentTime;
  const end   = start + FADE_MS / 1000;

  gFrom.gain.cancelScheduledValues(start);
  gTo.gain.cancelScheduledValues(start);

  gFrom.gain.setValueAtTime(gFrom.gain.value, start);
  gFrom.gain.linearRampToValueAtTime(0, end);

  gTo.gain.setValueAtTime(gTo.gain.value, start);
  gTo.gain.linearRampToValueAtTime(1, end);

  fadeStartMs = performance.now();
  const tick = () => {
    if (performance.now() - fadeStartMs >= FADE_MS) {
      active = to;
      fading = false;
    } else {
      requestAnimationFrame(tick);
    }
  };
  requestAnimationFrame(tick);
}

/* ---------- gesture bootstrap (very robust) ---------- */

async function firstGesture(){
  log("firstGesture fired");
  try {
    await ensureGraph();
  } catch(e){
    err("ensureGraph failed", e);
  }
}

/* also catch clicks, just in case */
function attachGlobalGestures(){
  // capture to be first
  document.addEventListener("pointerdown", firstGesture, { once: true, capture: true, passive: true });
  document.addEventListener("touchstart", firstGesture,   { once: true, capture: true, passive: true });
  document.addEventListener("click", firstGesture,        { once: true, capture: true, passive: true });
}

/* ---------- init ---------- */

document.addEventListener("DOMContentLoaded", () => {
  log("DOMContentLoaded, urls:", urls);
  if (!urls.length) {
    err("no TRACK_URLS provided – nothing to play");
  }

  showOnly(0);
  attachGlobalGestures();

  // slider taps
  sliders.forEach((slider, idx) => {
    slider.style.touchAction = "manipulation";
    slider.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      // if not ready, ensure graph then switch
      if (!started || !resumed || buffers.length === 0) {
        ensureGraph().then(()=>{
          if (idx === active) crossfadeTo(nextIdx(active));
          else                crossfadeTo(idx);
        }).catch(err);
        return;
      }
      if (idx === active) crossfadeTo(nextIdx(active));
      else                crossfadeTo(idx);
    }, { passive: false });
  });
});