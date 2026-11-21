// Where two renders of a page differ, as boxes in the after image's pixels. Both images are
// read at half size, compared in 8px cells, and touching cells merge into regions.
const load = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });

export type Box = { x: number; y: number; w: number; h: number };

export async function diffBoxes(beforeSrc: string, afterSrc: string): Promise<{ boxes: Box[]; width: number; height: number }> {
  const [a, b] = await Promise.all([load(beforeSrc), load(afterSrc)]);
  const S = 0.5, CELL = 8;
  const W = Math.round(b.naturalWidth * S);
  const H = Math.round(b.naturalHeight * S);
  const ha = Math.round(a.naturalHeight * S);
  const read = (img: HTMLImageElement, h: number) => {
    const c = document.createElement("canvas");
    c.width = W; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, W, h);
    return g.getImageData(0, 0, W, h).data;
  };
  const da = read(a, ha), db = read(b, H);
  const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL);
  const hot = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      let changed = 0, n = 0;
      for (let y = r * CELL; y < Math.min(H, (r + 1) * CELL); y += 2) {
        for (let x = q * CELL; x < Math.min(W, (q + 1) * CELL); x += 2) {
          n++;
          const i = (y * W + x) * 4;
          if (y >= ha) { changed++; continue; }
          const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
          if (d > 42) changed++;
        }
      }
      if (changed / n > 0.04) hot[r * cols + q] = 1;
    }
  }
  // Grow each hot cell by two so nearby edits read as one region, then flood.
  const grown = new Uint8Array(hot.length);
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    if (!hot[r * cols + q]) continue;
    for (let y = Math.max(0, r - 2); y <= Math.min(rows - 1, r + 2); y++)
      for (let x = Math.max(0, q - 2); x <= Math.min(cols - 1, q + 2); x++) grown[y * cols + x] = 1;
  }
  const seen = new Uint8Array(hot.length);
  const boxes: Box[] = [];
  for (let s = 0; s < grown.length; s++) {
    if (!grown[s] || seen[s]) continue;
    let x0 = cols, y0 = rows, x1 = 0, y1 = 0, real = 0;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const q = i % cols, r = (i - q) / cols;
      if (hot[i]) { real++; x0 = Math.min(x0, q); y0 = Math.min(y0, r); x1 = Math.max(x1, q); y1 = Math.max(y1, r); }
      for (const j of [i - 1, i + 1, i - cols, i + cols]) {
        if (j < 0 || j >= grown.length || seen[j] || !grown[j]) continue;
        if ((j === i - 1 && q === 0) || (j === i + 1 && q === cols - 1)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (real < 2) continue;
    const k = CELL / S;
    boxes.push({ x: x0 * k, y: y0 * k, w: (x1 - x0 + 1) * k, h: (y1 - y0 + 1) * k });
  }
  return { boxes, width: b.naturalWidth, height: b.naturalHeight };
}
