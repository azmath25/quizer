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
// Hybrid devices: follow whichever input was used last.
addEventListener("touchstart", () => sync("touch"), { passive: true });
addEventListener("mousemove", (event) => event.movementX | event.movementY && sync("mouse"), { passive: true });
