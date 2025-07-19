/* ───── constants ───── */
const XFADE_MS   = 2000;      // cross-fade time (ms)
const STEPS      = 4;         // 0-4  → 0-25-50-75-100 %
const STEP_PCT   = 100 / STEPS;
const DEFAULT    = 3;         // 75 % on power-up
const QUIET_WAIT = 250;       // ms before auto-fallback fires

/* ───── elements ───── */
const sliders = [...document.querySelectorAll(".v-slider")];
const fills   = [...document.querySelectorAll(".slider-fill")];
const tracks  = [...document.querySelectorAll(".track")];

/* ───── state ───── */
let active    = 0;            // track currently audible
let fading    = false;        // true while cross-fade running
let fadeTo    = 0;
let fadeVol   = 1;
let fadeStart = 0;

/* ───── helpers ───── */
const pct        = s => s * STEP_PCT;
const clamp01    = v => Math.max(0, Math.min(1, v));
const setBar     = (i, p) => { fills[i].style.height = `${p}%`; };
const nextIndex  = i => (i + 1) % tracks.length;
const audibleAny = () => tracks.some(t => t.volume > 0.0001);

function stepFromY(y, slider){
  const r = slider.getBoundingClientRect();
  const rel = 1 - (y - r.top) / r.height;      // 0 bottom → 1 top
  return Math.max(0, Math.min(STEPS, Math.round(rel * STEPS)));
}

/* never-silent auto-fallback */
function ensureNotSilent(){
  if (audibleAny() || fading) return;

  active = nextIndex(active);
  const t = tracks[active];
  const src = tracks[(active + tracks.length - 1) % tracks.length];

  t.currentTime = src.currentTime % t.duration;
  t.play().catch(()=>{});
  t.volume = DEFAULT / STEPS;
  setBar(active, pct(DEFAULT));
}

/* initialize tracks */
tracks.forEach(t=>{
  t.loop    = true;
  t.volume  = 0;
  t.play().catch(()=>{});         // will unblock on first gesture
});
tracks[0].volume = DEFAULT / STEPS;
setBar(0, pct(DEFAULT));

/* ───── core fade logic (single RAF) ───── */
function frame(now){
  if (fading){
    const t = Math.min(1, (now - fadeStart) / XFADE_MS);
    const from = tracks[active];
    const to   = tracks[fadeTo];

    const vOut = clamp01(fadeVol * (1 - t));
    const vIn  = clamp01(fadeVol * t);

    from.volume = vOut;
    to.volume   = vIn;

    setBar(active,  pct(STEPS) * (vOut / fadeVol));
    setBar(fadeTo, pct(STEPS) * (vIn  / fadeVol));

    if (t === 1){
      from.pause();
      from.currentTime = to.currentTime;   // keep “radio” sync
      active  = fadeTo;
      fading  = false;
      ensureNotSilent();
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ───── fade starter ───── */
function startFade(idx, step){
  const volPct = pct(step);
  const volVal = step / STEPS;

  /* same bar → just set volume */
  if (idx === active && !fading){
    tracks[active].volume = volVal;
    setBar(active, volPct);
    ensureNotSilent();
    return;
  }
  if (fading) return;          // ignore until current fade ends

  /* begin new fade */
  fading     = true;
  fadeTo     = idx;
  fadeVol    = volVal;
  fadeStart  = performance.now();

  const from = tracks[active];
  const to   = tracks[fadeTo];

  to.currentTime = from.currentTime % to.duration;
  to.volume = 0;
  to.play().catch(()=>{});

  from.volume = fadeVol;       // fade-out starts from current level
  setBar(fadeTo, 0);           // new bar grows from 0 %
}

/* ───── user interaction (Hammer pan) ───── */
sliders.forEach((slider, idx)=>{
  slider.style.userSelect = "none";
  const hamm = new Hammer(slider);
  hamm.get('pan').set({ direction: Hammer.DIRECTION_VERTICAL, threshold: 0 });

  /* tap (panstart), drag (panmove), release (panend) */
  hamm.on('panstart', ev=>{
    unlockAudio();
    slider._dragging = true;
    handleEvent(ev);
  });
  hamm.on('panmove', handleEvent);
  hamm.on('panend pancancel', ()=>{
    slider._dragging = false;
    clearTimeout(quietTimer);
    quietTimer = setTimeout(ensureNotSilent, QUIET_MS);
  });

  function handleEvent(ev){
    if(!slider._dragging) return;
    const step = stepFromY(ev.center.y, slider);
    change(idx, step);
  }
});


/* unlock audio on first user gesture */
window.addEventListener("pointerdown", ()=>{
  tracks.forEach(t=>t.play().catch(()=>{}));
}, { once:true });