// Marks <html> with the active input type so CSS and scripts can adapt per device.
const root = document.documentElement,
  coarse = matchMedia("(pointer: coarse)"),
  noHover = matchMedia("(hover: none)");
export const scrollBehavior = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
export const isTouch = () => root.dataset.input === "touch";
function sync(force) {
  root.dataset.input = force ?? (coarse.matches || noHover.matches ? "touch" : "mouse");
}
sync();
coarse.addEventListener?.("change", () => sync());
// Hybrid devices: follow the last genuine input, not the synthetic mouse
// events generated after a finger tap (which previously flipped touch to mouse).
let lastTouchAt = -Infinity;
function markTouch() {
  lastTouchAt = performance.now();
  sync("touch");
}
addEventListener("touchstart", markTouch, { passive: true });
addEventListener("pointerdown", (event) => {
  if (event.pointerType === "touch") markTouch();
  else if (event.pointerType === "mouse" &&
    performance.now() - lastTouchAt > 1200) sync("mouse");
}, { passive: true });
addEventListener("mousemove", (event) => {
  if (event.sourceCapabilities?.firesTouchEvents ||
    performance.now() - lastTouchAt <= 1200) return;
  if (event.movementX || event.movementY) sync("mouse");
}, { passive: true });
