// The fix-layer ladder, strongest first. A fix that lives in the harness (a
// check, a validator, a tool contract, saved state) holds on every run; a
// prompt rule holds only while the model remembers it. Self-improvement
// (crew/self-improve.ts) and taste (council/taste-checks.ts) both climb it.
export const FIX_LAYERS = ["check", "tool", "context", "state", "trace", "prompt"] as const;
export type FixLayer = typeof FIX_LAYERS[number];
