// Days, the canvas's unit of time: a key to group by, the last moment of one, and its name.
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const endOfDay = (d: Date) => { const e = new Date(d); e.setHours(23, 59, 59, 999); return e.getTime(); };
export const dayLabel = (d: Date) => dayKey(d) === dayKey(new Date()) ? "Today" : d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
