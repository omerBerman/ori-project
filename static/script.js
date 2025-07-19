/* ---------- constants ---------- */
const STEPS = 4;               // 0‑25‑50‑75‑100 %
const PCT   = 100 / STEPS;
const DEFAULT = 3;             // 75 %
const XFADE  = 2000;           // ms
const QUIET  = 300;            // ms delay for auto‑fallback

/* ---------- elements ---------- */
const sliders = [...document.querySelectorAll(".v-slider")];
const fills   = [...document.querySelectorAll(".slider-fill")];
const tracks  = [...document.querySelectorAll(".track")];
const overlay = document.getElementById("unlock");

/* ---------- state ---------- */
let active = 0;
let fading = false;
let fadeTo = 0;
let fadeVol = 1;
let fadeStart = 0;
let quietTimer = null;
let unlocked = false;

/* ---------- helpers ---------- */
const pct = s => s * PCT;
const setBar = (i, p) => (fills[i].style.height = `${p}%`);
const stepFrom = (y, box) =>
  Math.max(0, Math.min(STEPS, Math.round((1 - (y - box.top) / box.height) * STEPS)));
const nextIdx = i => (i + 1) % tracks.length;
const audibleAny = () => tracks.some(t => t.volume > 0.0001);

/* ---------- unlock first tap ---------- */
function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  overlay.classList.add("d-none");
  tracks.forEach(t => t.play().catch(() => {}));
  tracks[0].volume = DEFAULT / STEPS;
}
overlay.addEventListener("click", unlockAudio, { once: true });

/* ---------- preload & default bar ---------- */
tracks.forEach(t => {
  t.loop = true;
  t.volume = 0;
  t.play().catch(() => {});
});
setBar(0, pct(DEFAULT));

/* ---------- never‑silent rule ---------- */
function ensureNotSilent() {
  if (audibleAny() || fading) return;
  active = nextIdx(active);
  const src = tracks[active === 0 ? tracks.length - 1 : active - 1];
  const t   = tracks[active];
  t.currentTime = src.currentTime % t.duration;
  t.volume = DEFAULT / STEPS;
  setBar(active, pct(DEFAULT));
}

/* ---------- fade loop ---------- */
function raf(ts) {
  if (fading) {
    const d = Math.min(1, (ts - fadeStart) / XFADE);
    const from = tracks[active];
    const to   = tracks[fadeTo];
    from.volume = fadeVol * (1 - d);
    to.volume   = fadeVol * d;
    setBar(active, pct(STEPS) * (from.volume / fadeVol));
    setBar(fadeTo, pct(STEPS) * (to.volume / fadeVol));
    if (d === 1) {
      from.pause();
      from.currentTime = to.currentTime;
      active = fadeTo;
      fading = false;
      ensureNotSilent();
    }
  }
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

/* ---------- volume/fade change ---------- */
function change(idx, step) {
  const v = step / STEPS;
  if (idx === active && !fading) {
    tracks[active].volume = v;
    setBar(active, pct(step));
    return;
  }
  if (fading) return;

  fading = true;
  fadeTo = idx;
  fadeVol = v;
  fadeStart = performance.now();

  const from = tracks[active];
  const to   = tracks[fadeTo];
  to.currentTime = from.currentTime % to.duration;
  to.volume = 0;
  to.play().catch(() => {});
  from.volume = v;
  setBar(fadeTo, 0);
}

/* ---------- interaction per bar ---------- */
sliders.forEach((slider, idx) => {
  slider.style.userSelect = "none";
  const box = slider.getBoundingClientRect();
  let dragging = false;

  const start = e => {
    unlockAu
