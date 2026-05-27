export function serialize(meta: Record<string, string>, body: string): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(meta)) {
    lines.push(`${k}: ${v}`);
  }
  lines.push("---", "", body);
  return lines.join("\n");
}
