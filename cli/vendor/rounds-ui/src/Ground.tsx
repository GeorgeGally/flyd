// The ground: daylight on a studio table. The paper is anchored to the world and moves with
// the camera; the light belongs to the room and stays put, falling from the upper left, with
// slow cloud shade drifting across it. Warmth follows the clock: neutral in the morning,
// honey toward evening, a lamp pool at night. Colour is mixed in OKLAB and dithered.
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { Cam } from "./camera";
import { look } from "./look";

const VERT = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 res;      // device pixels
uniform vec3 cam;      // x, y in css px, zoom
uniform float dpr;
uniform float t;       // seconds
uniform float warm;    // 0 morning .. 1 evening
uniform float night;   // 0 day .. 1 night
uniform float dim;     // 0 .. 1 when a page is open
uniform vec3 gLight, gShade, gWarmLight, gWarmShade; // the look's paper, in sRGB
out vec4 o;

vec3 toLin(vec3 c) { return pow(c, vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
vec3 lin2lab(vec3 c) {
  float l = 0.4122214708*c.r + 0.5363325363*c.g + 0.0514459929*c.b;
  float m = 0.2119034982*c.r + 0.6806995451*c.g + 0.1073969566*c.b;
  float s = 0.0883024619*c.r + 0.2817188376*c.g + 0.6299787005*c.b;
  l = pow(l, 1.0/3.0); m = pow(m, 1.0/3.0); s = pow(s, 1.0/3.0);
  return vec3(0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
              1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
              0.0259040371*l + 0.7827717662*m - 0.8086757660*s);
}
vec3 lab2lin(vec3 c) {
  float l = c.x + 0.3963377774*c.y + 0.2158037573*c.z;
  float m = c.x - 0.1055613458*c.y - 0.0638541728*c.z;
  float s = c.x - 0.0894841775*c.y - 1.2914855480*c.z;
  l = l*l*l; m = m*m*m; s = s*s*s;
  return vec3(4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
             -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
             -0.0041960863*l - 0.7034186147*m + 1.7076147010*s);
}
vec3 lab(vec3 srgb) { return lin2lab(toLin(srgb)); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int k = 0; k < 3; k++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}

void main() {
  vec2 px = gl_FragCoord.xy / dpr;
  px.y = res.y / dpr - px.y;               // css px, top left origin
  vec2 screen = px / (res / dpr);          // 0..1
  vec2 world = (px - cam.xy) / cam.z;      // world px

  // Paper: broad mottling anchored to the table, felt more than seen.
  float paper = fbm(world / 2600.0) - 0.5;

  // Window light from the upper left, a long soft falloff.
  vec2 src = vec2(-0.15, -0.25);
  float d = length((screen - src) * vec2(0.85, 1.0));
  float light = smoothstep(1.9, 0.15, d);

  // Cloud shade drifting across the light, slow and broad, domain warped once.
  vec2 q = screen * vec2(1.6, 1.0) * 1.3 + vec2(t * 0.006, t * 0.002);
  vec2 w = vec2(fbm(q + 3.1), fbm(q + 8.7));
  float shade = smoothstep(0.35, 0.75, fbm(q + 1.6 * w));
  light *= 1.0 - 0.32 * shade;

  // Night: a lamp pool replaces the window, the room around it dimmer.
  float lamp = smoothstep(1.15, 0.05, length((screen - vec2(0.62, 0.42)) * vec2(0.8, 1.0)));
  light = mix(light, lamp, night);

  vec3 shadowTone = mix(lab(gShade), lab(gWarmShade), warm);
  vec3 lightTone  = mix(lab(gLight), lab(gWarmLight), warm);
  shadowTone = mix(shadowTone, lab(gWarmShade) - vec3(0.012, 0.0, 0.0), night);
  lightTone  = mix(lightTone, lab(gWarmLight), night);

  vec3 c = mix(shadowTone, lightTone, light);
  c.x += paper * 0.012;
  c.x -= dim * 0.035;

  vec3 rgb = toSrgb(lab2lin(c));
  rgb += (hash(gl_FragCoord.xy + fract(t)) - 0.5) / 255.0; // dither
  // static paper grain, drawn here so nothing has to blend over the whole window
  rgb *= 1.0 - 0.03 * hash(floor(gl_FragCoord.xy) * 0.917 + 3.1);
  o = vec4(rgb, 1.0);
}`;

function clock() {
  const h = new Date().getHours() + new Date().getMinutes() / 60;
  const warm = Math.min(1, Math.max(0, (h - 10) / 8)); // 10am neutral .. 6pm honey
  const night = h < 6 ? 1 : h < 7.5 ? 1 - (h - 6) / 1.5 : h > 19.5 ? Math.min(1, (h - 19.5) / 1.5) : 0;
  return { warm, night };
}

export function Ground({ cam, dim }: { cam: MutableRefObject<Cam>; dim: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useRef({ dim: 0, dimTarget: 0 });
  state.current.dimTarget = dim ? 1 : 0;

  useEffect(() => {
    const canvas = ref.current!;
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false });
    if (!gl) return;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const g = look().ground;
    gl.uniform3fv(u("gLight"), g.light);
    gl.uniform3fv(u("gShade"), g.shade);
    gl.uniform3fv(u("gWarmLight"), g.warmLight);
    gl.uniform3fv(u("gWarmShade"), g.warmShade);
    const U = { res: u("res"), cam: u("cam"), dpr: u("dpr"), t: u("t"), warm: u("warm"), night: u("night"), dim: u("dim") };

    // Half resolution is plenty for light this soft.
    const scale = 0.5;
    const size = () => {
      const dpr = Math.min(2, devicePixelRatio) * scale;
      canvas.width = Math.round(innerWidth * dpr);
      canvas.height = Math.round(innerHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(U.dpr, dpr);
    };
    size();
    addEventListener("resize", size);

    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let raf = 0, last = 0, tone = clock(), toneAt = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const s = state.current;
      const moving = cam.current !== (frame as any).cam || Math.abs(s.dim - s.dimTarget) > 0.001;
      // The light drifts slowly: four frames a second is enough unless the camera moves.
      if (!moving && now - last < 250) return;
      last = now;
      (frame as any).cam = cam.current;
      s.dim += (s.dimTarget - s.dim) * 0.12;
      if (now - toneAt > 60e3) { tone = clock(); toneAt = now; }
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform3f(U.cam, cam.current.x, cam.current.y, cam.current.z);
      gl.uniform1f(U.t, still ? 0 : (now - start) / 1000);
      gl.uniform1f(U.warm, tone.warm);
      gl.uniform1f(U.night, tone.night);
      gl.uniform1f(U.dim, s.dim);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", size); };
  }, []);

  return <canvas ref={ref} className="fixed inset-0 h-full w-full" aria-hidden />;
}
