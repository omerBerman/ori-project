/* =========================================================
 * Radio Mixer — script.js
 * - 4 square sliders
 * - click toggles channel: same bar -> off & advance next
 * - different bar -> switch to that bar
 * - UI shows 80% fill when active, 0% when off
 * - Audio: crossfade between two <audio> elements (ping-pong)
 * - Mobile safe: unlock on first pointer/touch
 * ======================================================= */

/* ---------- configuration ---------- */
const LEVEL_PCT        = 80;     // UI fill when active
const FILL_UP_MS       = 280;    // fill rise
const FILL_DOWN_MS     = 450;    // fill drop (slower)
const AUDIO_FADE_IN_MS = 200;    // audio in
const AUDIO_FADE_OUT_MS= 280;    // audio out (slightly slower)
const MIN_VOL          = 0.0;
const MAX_VOL          = 1.0;

/* ---------- elements ---------- */
const sliders = Array.from(document.querySelectorAll('.v-slider'));
const fills   = Array.from(document.querySelectorAll('.slider-fill'));
const RULER   = document.querySelector('.ruler');

/* one logical player built from two <audio> elements for crossfade */
const players = [
  document.getElementById('player'),
  document.createElement('audio')
];
players[0].setAttribute('playsinline', '');
players[1].setAttribute('playsinline', '');
players[1].preload = 'auto';
document.body.appendChild(players[1]); // hidden but present for iOS
players.forEach(a => {
  a.loop = true;
  a.volume = 0;
});

/* track list injected from Flask */
const TRACKS = Array.isArray(window.TRACK_URLS) ? window.TRACK_URLS : [];

/* durations and global radio clock */
const meta = TRACKS.map(() => ({ duration: 0 }));
let bootTime = performance.now() / 1000; // seconds base

/* ui state */
let active = 0;                        // current channel index audible
let currentPlayer = 0;                 // which audio element is 'from'
let isFading = false;

/* per bar animation state */
const nowFill = fills.map(() => 0);          // current height %
const tgtFill = fills.map(() => 0);          // target height %
const upRate  = LEVEL_PCT / FILL_UP_MS;      // % per ms
const dnRate  = LEVEL_PCT / FILL_DOWN_MS;    // % per ms

/* ---------- helpers ---------- */
const clamp01  = v => Math.max(0, Math.min(1, v));
const pctToStr = p => `${p.toFixed(3)}%`;
const nextIdx  = i => (i + 1) % TRACKS.length;

function barOn(i){
  tgtFill[i] = LEVEL_PCT;
}
function barOff(i){
  tgtFill[i] = 0;
}

function setFillInstant(i, p){
  nowFill[i] = tgtFill[i] = p;
  fills[i].style.height = pctToStr(p);
}

/* compute where song i should be (“radio style”) */
function playheadFor(i){
  const d = meta[i].duration || 1;
  const now = performance.now() / 1000;
  const pos = (now - bootTime) % d;
  return pos < 0 ? pos + d : pos;
}

/* load metadata (duration) once per track */
function ensureMetadata(i){
  return new Promise((resolve) => {
    if (meta[i].duration > 0) return resolve();
    const tmp = document.createElement('audio');
    tmp.preload = 'metadata';
    tmp.src = TRACKS[i];
    tmp.addEventListener('loadedmetadata', () => {
      meta[i].duration = tmp.duration || 0;
      resolve();
    }, { once:true });
    // fallback resolve after timeout to avoid hang
    setTimeout(() => resolve(), 1500);
  });
}

/* start playing specific track on a given <audio> element */
async function armPlayer(player, trackIdx){
  await ensureMetadata(trackIdx);
  player.src = TRACKS[trackIdx];
  try {
    // set playhead to radio position
    const t = playheadFor(trackIdx);
    // must await loadedmetadata to set currentTime safely
    await new Promise(res => {
      if (player.readyState >= 1) return res();
      player.addEventListener('loadedmetadata', res, { once:true });
    });
    if (isFinite(player.duration) && player.duration > 0){
      player.currentTime = t % player.duration;
    }
  } catch (e) {
    // ignore, we will still try to play
  }
  await player.play().catch(()=>{});
}

/* crossfade between players */
async function crossfade(toIdx){
  if (isFading) return;
  isFading = true;

  const fromP = players[currentPlayer];
  const toP   = players[currentPlayer ^ 1];

  await armPlayer(toP, toIdx);

  const start = performance.now();
  const outDur = AUDIO_FADE_OUT_MS;
  const inDur  = AUDIO_FADE_IN_MS;

  function step(ts){
    const tOut = clamp01((ts - start) / outDur);
    const tIn  = clamp01((ts - start) / inDur);

    const vOut = clamp01(1 - tOut);
    const vIn  = clamp01(tIn);

    fromP.volume = vOut;
    toP.volume   = vIn;

    if (tOut >= 1 && tIn >= 1){
      fromP.pause();
      fromP.volume = 0;
      currentPlayer ^= 1;
      isFading = false;
    } else {
      requestAnimationFrame(step);
    }
  }
  requestAnimationFrame(step);
}

/* handle bar click */
function handleTap(idx){
  if (idx === active){
    // tap same bar -> turn it off and advance to next
    const next = nextIdx(active);
    barOff(active);
    barOn(next);
    crossfade(next);
    active = next;
  } else {
    // switch directly
    barOff(active);
    barOn(idx);
    crossfade(idx);
    active = idx;
  }
}

/* animate fills smoothly with different rise/fall speeds */
function animate(){
  const dt = 16; // approximate per frame ms
  for (let i=0;i<fills.length;i++){
    const target = tgtFill[i];
    const cur    = nowFill[i];
    if (Math.abs(target - cur) < 0.1){
      nowFill[i] = target;
    } else if (target > cur){
      nowFill[i] = Math.min(target, cur + upRate * dt);
    } else {
      nowFill[i] = Math.max(target, cur - dnRate * dt);
    }
    fills[i].style.height = pctToStr(nowFill[i]);
  }
  requestAnimationFrame(animate);
}

/* unlock audio on first gesture (iOS) */
function installUnlock(){
  const unlock = () => {
    players.forEach(a => a.play().then(()=>a.pause()).catch(()=>{}));
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('touchstart', unlock);
  };
  document.addEventListener('pointerdown', unlock, { passive:true, once:true });
  document.addEventListener('touchstart',  unlock, { passive:true, once:true });
}

/* ----- init ----- */
async function init(){
  if (!TRACKS.length || sliders.length !== fills.length){
    console.warn('mixer: invalid DOM or no tracks');
    return;
  }

  installUnlock();

  // UI events: click/tap only (אין גרירה)
  sliders.forEach((el, i)=>{
    el.addEventListener('click',   ()=>handleTap(i), { passive:true });
    el.addEventListener('pointerup', ()=>handleTap(i), { passive:true });
  });

  // boot: channel 0 at 80%
  active = 0;
  setFillInstant(0, LEVEL_PCT);
  for (let i=1;i<fills.length;i++) setFillInstant(i, 0);

  // prepare and start first player
  currentPlayer = 0;
  await armPlayer(players[currentPlayer], active);
  players[currentPlayer].volume = 1;

  // keep the alternate player warmed
  players[currentPlayer ^ 1].volume = 0;

  requestAnimationFrame(animate);
}

document.addEventListener('DOMContentLoaded', init);