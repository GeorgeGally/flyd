// What changed between two versions of a page, block by block: each version loads in a
// hidden frame at desktop width, its leaf blocks (a paragraph, a heading, a list item, an
// image) are read in order, and the longest common run between them leaves only what was
// added or rewritten (marked on the after) and what was cut (marked on the before). Text
// that only moved down the page is not a change.
import type { Box } from "./diff";

type Block = { sig: string; box: Box };

const LEAF = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "PRE", "BLOCKQUOTE", "FIGCAPTION", "TD", "TH", "DT", "DD", "IMG", "SVG", "CANVAS", "VIDEO", "BUTTON", "SUMMARY", "LABEL"]);

function read(doc: Document): Block[] {
  const out: Block[] = [];
  const win = doc.defaultView!;
  const walk = (el: Element) => {
    const tag = el.tagName.toUpperCase();
    const style = win.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;
    const media = tag === "IMG" || tag === "SVG" || tag === "CANVAS" || tag === "VIDEO";
    const hasLeafChild = !media && [...el.children].some((c) => LEAF.has(c.tagName.toUpperCase()) || c.querySelector("p,h1,h2,h3,h4,li,img,pre"));
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
    const isLeaf = media || (LEAF.has(tag) && !hasLeafChild) || (ownText && !hasLeafChild && style.display !== "inline");
    if (isLeaf) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return;
      const text = media ? `${tag}:${(el as HTMLImageElement).getAttribute("src") || el.getAttribute("viewBox") || ""}:${Math.round(r.width)}x${Math.round(r.height)}` : (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240);
      if (!text) return;
      out.push({ sig: `${tag}|${text}`, box: { x: r.left + win.scrollX, y: r.top + win.scrollY, w: r.width, h: r.height } });
      return;
    }
    for (const c of el.children) walk(c);
  };
  if (doc.body) walk(doc.body);
  return out;
}

function load(src: string): Promise<{ blocks: Block[]; frame: HTMLIFrameElement }> {
  return new Promise((resolve, reject) => {
    const f = document.createElement("iframe");
    f.style.cssText = "position:fixed;left:-20000px;top:0;width:1280px;height:800px;border:0;visibility:hidden;pointer-events:none";
    f.src = src;
    const timer = setTimeout(() => reject(new Error("timeout")), 15000);
    f.onload = () => setTimeout(() => {
      clearTimeout(timer);
      try { resolve({ blocks: read(f.contentDocument!), frame: f }); } catch (e) { reject(e); }
    }, 900);
    document.body.appendChild(f);
  });
}

function lcs(a: string[], b: string[]): [Set<number>, Set<number>] {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keepA = new Set<number>(), keepB = new Set<number>();
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { keepA.add(i++); keepB.add(j++); }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return [keepA, keepB];
}

// Neighbouring marks become one region, so a rewritten section reads as one change.
function merge(boxes: Box[]): Box[] {
  const sorted = [...boxes].sort((p, q) => p.y - q.y);
  const out: Box[] = [];
  for (const b of sorted) {
    const last = out[out.length - 1];
    if (last && b.y <= last.y + last.h + 28 && b.x < last.x + last.w + 40 && b.x + b.w > last.x - 40) {
      const x = Math.min(last.x, b.x), y = Math.min(last.y, b.y);
      last.w = Math.max(last.x + last.w, b.x + b.w) - x;
      last.h = Math.max(last.y + last.h, b.y + b.h) - y;
      last.x = x; last.y = y;
    } else out.push({ ...b });
  }
  return out;
}

export type Changes = { added: Box[]; removed: Box[] } | null;

export async function blockChanges(beforeSrc: string, afterSrc: string): Promise<Changes> {
  const [a, b] = await Promise.all([load(beforeSrc), load(afterSrc)]);
  a.frame.remove(); b.frame.remove();
  if (a.blocks.length < 3 || b.blocks.length < 3 || a.blocks.length * b.blocks.length > 4e6) return null;
  const [keepA, keepB] = lcs(a.blocks.map((x) => x.sig), b.blocks.map((x) => x.sig));
  return {
    added: merge(b.blocks.filter((_, i) => !keepB.has(i)).map((x) => x.box)),
    removed: merge(a.blocks.filter((_, i) => !keepA.has(i)).map((x) => x.box)),
  };
}
