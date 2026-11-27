/** "PostgreSQL 19 Released" — a version line, not a story. */
const BARE_RELEASE = /^(?:[\w.+#-]{2,48}\s+){1,3}v?\d+(?:\.\d+){0,3}\s+released\.?$/i;

/** Tools and models George follows: their releases are news to him, not filler. */
const FOLLOWED_TOOL = /\b(?:p5(?:\.?js)?|processing|blender|touchdesigner|three\.?js|openframeworks|vvvv|hydra|cables|nannou|godot|comfyui|stable\s*diffusion|flux|midjourney|claude|gpt|gemini|llama|mistral|deepseek|qwen|ordinals?|bitcoin|esp32|arduino|raspberry\s*pi)\b/i;

/** A headline that only names a release of a tool outside George's interests, which the edition never spends a pick on. */
export function isBareRelease(title: string): boolean {
  const line = title.trim();
  return BARE_RELEASE.test(line) && !FOLLOWED_TOOL.test(line);
}
