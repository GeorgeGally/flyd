// The wren line glyphs (NEUMA kit, LineGlyphSet.swift): a 24 unit grid, one round-capped line
// at 1.8 units, and on round forms a crescent face, the light falling from the upper left.
import { useId } from "react";

const BUBBLE = "M8 2.75H16A6 6 0 0 1 22 8.75V11A6 6 0 0 1 16 17H9.5C6.25 17 3.25 19.25 2 21.5V8.75A6 6 0 0 1 8 2.75Z";
const ARM = 6.5;
const head = (x: number, y: number, deg: number) => {
  const a = ((deg + 135) * Math.PI) / 180, b = ((deg + 225) * Math.PI) / 180;
  return `M${x + ARM * Math.cos(a)} ${y + ARM * Math.sin(a)}L${x} ${y}L${x + ARM * Math.cos(b)} ${y + ARM * Math.sin(b)}`;
};

const EYE = "M1.75 12C4.5 8.25 7.75 5.5 12 5.5C16.25 5.5 19.5 8.25 22.25 12C19.5 15.75 16.25 18.5 12 18.5C7.75 18.5 4.5 15.75 1.75 12Z";
const PUPIL = "M15.6 12A3.6 3.6 0 1 1 8.4 12A3.6 3.6 0 1 1 15.6 12Z";

type Name = "comment" | "close" | "send" | "done" | "open" | "back" | "next" | "eye"
  | "move" | "hand" | "add" | "minus" | "search" | "fit" | "time" | "photos" | "copy";

// From the Wren line set (LineGlyphSet.swift), point for point: its search lens, its errand
// pointer, its clock, its Scan corners, its Photo.
const LENS = "M17.6 10A7.6 7.6 0 1 1 2.4 10A7.6 7.6 0 1 1 17.6 10Z";
const POINTER = "M6 2.5L6 18.5L9.75 15L12.5 21L15 19.75L12.25 13.75L17.75 13.75Z";
const DIAL = "M22.3 12A10.3 10.3 0 1 1 1.7 12A10.3 10.3 0 1 1 22.3 12Z";

// a solid round mark (the sun in a photo), drawn filled
const disc = (x: number, y: number, r: number) => `M${x + r} ${y}A${r} ${r} 0 1 1 ${x - r} ${y}A${r} ${r} 0 1 1 ${x + r} ${y}Z`;

const LINES: Record<Name, { d: string; face?: string; solid?: string }> = {
  comment: { d: `${BUBBLE}M8.25 9.9H15.75`, face: BUBBLE },
  close: { d: "M4.75 4.75L19.25 19.25M19.25 4.75L4.75 19.25" },
  send: { d: `M12 21.5V2.5${head(12, 2.5, 270)}` },
  done: { d: "M3.5 12.5L9.25 18.25L20.5 5.75" },
  open: { d: `M4.5 19.5L19.5 4.5${head(19.5, 4.5, 315)}` },
  back: { d: `M21.5 12H2.5${head(2.5, 12, 180)}` },
  next: { d: `M2.5 12H21.5${head(21.5, 12, 0)}` },
  eye: { d: `${EYE}${PUPIL}`, face: PUPIL },
  move: { d: POINTER },
  hand: { d: "M8.25 12.5V5.75a1.6 1.6 0 0 1 3.2 0V11M11.45 10.5V4.1a1.6 1.6 0 0 1 3.2 0v6.6M14.65 10.75V5.9a1.6 1.6 0 0 1 3.2 0v5.6M17.85 10.25a1.55 1.55 0 0 1 3.1 0v3.6a7.4 7.4 0 0 1-7.4 7.4h-1.2a6.6 6.6 0 0 1-5.1-2.4L3.6 14.6a1.6 1.6 0 0 1 2.45-2.05l2.2 2.15" },
  add: { d: "M12 2.5V21.5M2.5 12H21.5" },
  minus: { d: "M4 12H20" },
  search: { d: `${LENS}M15.4 15.4L21 21`, face: LENS },
  fit: { d: "M2.5 7.5V6.3A3.8 3.8 0 0 1 6.3 2.5H7.5M21.5 7.5V6.3A3.8 3.8 0 0 0 17.7 2.5H16.5M2.5 16.5V17.7A3.8 3.8 0 0 0 6.3 21.5H7.5M21.5 16.5V17.7A3.8 3.8 0 0 1 17.7 21.5H16.5" },
  time: { d: `${DIAL}M12 5.5V12H16.5`, face: DIAL },
  // the set's Photo (photo.on.rectangle): a frame at a fifth of its short side, the hills, the sun
  // the kit's Copy: a sheet behind a sheet, the back one's lines stopping short of the front
  copy: { d: "M5.8 16.8H5.2A2.7 2.7 0 0 1 2.5 14.1V4.4A2.7 2.7 0 0 1 5.2 1.7H13.3A2.7 2.7 0 0 1 16 4.4V5M10.7 7.2H18.8A2.7 2.7 0 0 1 21.5 9.9V19.6A2.7 2.7 0 0 1 18.8 22.3H10.7A2.7 2.7 0 0 1 8 19.6V9.9A2.7 2.7 0 0 1 10.7 7.2Z" },
  photos: { d: "M1.75 7.35A3.1 3.1 0 0 1 4.85 4.25H19.15A3.1 3.1 0 0 1 22.25 7.35V16.65A3.1 3.1 0 0 1 19.15 19.75H4.85A3.1 3.1 0 0 1 1.75 16.65ZM1.75 16.5L7.5 11L13.25 16.75L15.75 14.25L20 18.5", solid: disc(16, 9, 1.75) },
};

// Pixel fitting, as the Wren set does it in Swift (LineGlyphGrid): the line is a whole number of
// device pixels at the size it's drawn, and every absolute point moves to where that line's two
// edges fall on pixel boundaries. Circles keep a whole radius. So no edge sits between pixels.
const ARGS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, A: 7, C: 6, S: 4, Q: 4, T: 2, Z: 0 };
function fit(d: string, s: number, w: number) {
  const off = w % 2 ? 0.5 : 0;
  const g = (v: number) => (Math.round(v * s - off) + off) / s;
  const r = (v: number) => Math.max(1, Math.round(v * s)) / s;
  const out: string[] = [];
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let cmd = "", i = 0;
  let at = [0, 0], atFit = [0, 0]; // where the pen is, as drawn and as fitted
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) { cmd = t; out.push(t); i++; if (cmd === "Z" || cmd === "z") continue; }
    const n = ARGS[cmd.toUpperCase()] ?? 0;
    const a = tokens.slice(i, i + n).map(Number);
    i += n;
    if (cmd !== cmd.toUpperCase()) { // relative: carried along, the pen moving by the same amount
      out.push(a.join(" "));
      const by = cmd === "h" ? [a[0], 0] : cmd === "v" ? [0, a[0]] : a.slice(-2);
      at = [at[0] + by[0], at[1] + by[1]]; atFit = [atFit[0] + by[0], atFit[1] + by[1]];
      continue;
    }
    const end = cmd === "H" ? [a[0], at[1]] : cmd === "V" ? [at[0], a[0]] : a.slice(-2);
    const endFit = [g(end[0]), g(end[1])];
    switch (cmd) {
      case "M": case "L": case "T": out.push(`${endFit[0]} ${endFit[1]}`); break;
      case "H": out.push(`${endFit[0]}`); break;
      case "V": out.push(`${endFit[1]}`); break;
      case "A": {
        // A circle is two half arcs. Rounding their radius apart from their ends made each half
        // bulge on its own (the lens read as a lumpy Q): a half arc's radius is half the
        // distance its fitted ends span, so the halves meet as one circle.
        const half = Math.abs(Math.hypot(end[0] - at[0], end[1] - at[1]) - 2 * a[0]) < 0.05;
        const rad = half ? Math.hypot(endFit[0] - atFit[0], endFit[1] - atFit[1]) / 2 : r(a[0]);
        out.push(`${rad} ${half ? rad : r(a[1])} ${a[2]} ${a[3]} ${a[4]} ${endFit[0]} ${endFit[1]}`);
        break;
      }
      default: { // curves: their ends on the grid, their handles carried along
        out.push([...a.slice(0, -2), endFit[0], endFit[1]].join(" "));
      }
    }
    at = end; atFit = endFit;
  }
  return out.join("");
}

export function Glyph({ name, size = 20, className }: { name: Name; size?: number; className?: string }) {
  const id = useId();
  const g = LINES[name];
  const dpr = typeof devicePixelRatio === "number" ? Math.max(1, Math.round(devicePixelRatio)) : 2;
  const s = (size / 24) * dpr; // device pixels per grid unit
  const w = Math.max(2, Math.round(1.8 * s)); // the line, in whole device pixels
  const d = fit(g.d, s, w);
  const face = g.face && fit(g.face, s, w);
  const solid = g.solid && fit(g.solid, s, w);
  const shift = (v: number) => Math.round(v * s) / s;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden style={{ shapeRendering: "geometricPrecision" }}>
      {face && (
        <>
          <mask id={id}>
            <path d={face} fill="white" />
            <path d={face} fill="black" transform={`translate(${shift(2.2)} ${shift(2.4)})`} />
          </mask>
          <path d={face} fill="currentColor" opacity={0.3} mask={`url(#${id})`} />
        </>
      )}
      <path d={d} stroke="currentColor" strokeWidth={w / s} strokeLinecap="round" strokeLinejoin="round" />
      {solid && <path d={solid} fill="currentColor" />}
    </svg>
  );
}
