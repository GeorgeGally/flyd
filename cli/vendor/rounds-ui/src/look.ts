// Looks, side by side while Kris picked: Mist won. ?look=paper|ember|graphite shows the others. Each is a paper, an ink, one accent spent on comments and what's
// new, a face for the project names, and the light the ground shader paints with.
export type Look = {
  ground: { light: number[]; shade: number[]; warmLight: number[]; warmShade: number[] };
};

export const LOOKS: Record<string, Look> = {
  // the current table, kept for comparison
  paper: { ground: { light: [0.985, 0.981, 0.968], shade: [0.905, 0.895, 0.872], warmLight: [0.992, 0.968, 0.918], warmShade: [0.902, 0.874, 0.826] } },
  // cool daylight, an ink that's nearly black-blue, a clear cobalt accent, SF for the names
  mist: { ground: { light: [0.975, 0.979, 0.983], shade: [0.895, 0.903, 0.912], warmLight: [0.98, 0.979, 0.976], warmShade: [0.9, 0.902, 0.903] } },
  // near-white warm, no yellow, an ember accent, Geist light for the names
  ember: { ground: { light: [0.988, 0.985, 0.98], shade: [0.912, 0.905, 0.895], warmLight: [0.99, 0.982, 0.97], warmShade: [0.912, 0.9, 0.884] } },
  // true neutral grey, no hue at all: the accent is ink, names in Geist Mono
  graphite: { ground: { light: [0.972, 0.972, 0.97], shade: [0.885, 0.885, 0.882], warmLight: [0.972, 0.972, 0.97], warmShade: [0.885, 0.885, 0.882] } },
};

export function pickLook(): string {
  // Mist is the look (his pick, Nov 19); ?look= shows another for that visit only
  const q = new URLSearchParams(location.search).get("look");
  const k = q && LOOKS[q] ? q : "mist";
  try { localStorage.removeItem("wb.look"); } catch {}
  document.documentElement.dataset.look = k;
  return k;
}
export const look = () => LOOKS[document.documentElement.dataset.look || "mist"] || LOOKS.mist;

// Reduce Transparency is on: glass goes solid, nothing blurs what's behind it
export const reducedTransparency = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-transparency: reduce)").matches;
// Reduce Motion is on: things fade into place instead of flying
export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
