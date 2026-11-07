import { describe, expect, it } from "vitest";
import { newsDeskOf } from "../activity.js";
import { parseHoroscope, signFromProfile } from "../horoscope.js";
import { todayNotes } from "../today.js";
import { forecastUrl, parseGeocode, parseWeather, placeNameFromProfile, WeatherReader } from "../weather.js";

const NOW = new Date(2026, 10, 7, 12, 0).getTime();
const at = (hour: number, day = 7) => new Date(2026, 10, day, hour, 30).toISOString();
const item = (id: string, headline: string, when: string, extra = {}) => ({ id, kind: "live", headline, why: "", at: when, ...extra }) as never;

describe("today's feed", () => {
  it("puts what is moving first, then the day newest first, from the records Flyd keeps", () => {
    const notes = todayNotes({
      show: { underway: [item("a", "CleanX is on your notes", at(10), { started: at(9), shots: [{ src: "/api/shot", label: "x" }] })], done: [item("b", "Logan landed its first phases", at(11), { project: "Logan" })] },
      activity: { now: [], recent: [
        { id: "m", kind: "memory", title: "Tidied memory", at: at(11) },
        { id: "w", kind: "work", title: "Logan stalled. I got it going again.", at: at(8) },
      ] },
      sessions: [{ id: "this", title: "This one", updatedAt: at(11) }, { id: "old", title: "Queue", project: "Logan", updatedAt: at(10) }],
      current: "this",
    }, NOW);
    expect(notes.map((note) => note.text)).toEqual(["CleanX is on your notes", "Logan landed its first phases", "You left off on Logan.", "Logan stalled. I got it going again."]);
    expect(notes[0]).toMatchObject({ moving: true, shot: "/api/shot" });
    expect(notes[0].aside).toMatch(/^Started \d\d:\d\d\.$/);
    expect(notes[1].aside).toBe("Logan");
  });

  it("reaches back to the last days on a quiet morning, never past a week", () => {
    const notes = todayNotes({ show: { landedWeek: [item("a", "Yesterday's work", at(9, 6)), item("b", "Long gone", new Date(2026, 9, 20).toISOString())] } }, NOW);
    expect(notes.map((note) => note.text)).toEqual(["Yesterday's work"]);
  });

  it("says the same thing once, and keeps a long note to one sentence", () => {
    const long = `Shipped it. ${"word ".repeat(60)}`;
    const notes = todayNotes({ show: { done: [item("a", "Same", at(9)), item("b", "same", at(8))], underway: [] , landedWeek: [item("c", `A long enough first sentence here. ${long}`, at(7))] } }, NOW);
    expect(notes.map((note) => note.text)).toEqual(["Same", "A long enough first sentence here."]);
  });
});

describe("today's feed from the job list", () => {
  const job = (id: string, group: string, title: string, when: string, extra = {}) => ({ id, group, title, at: when, next: "", digest: null, ...extra }) as never;

  it("stands on the jobs when the fleet has not been read, saying what changed", () => {
    const notes = todayNotes({ show: {}, jobs: [
      job("a", "working", "CleanX", at(10)),
      job("b", "done", "Logan", at(9), { digest: { changed: "Pages are live.", means: "", needed: "" } }),
    ] }, NOW);
    expect(notes[0]).toMatchObject({ text: "CleanX", moving: true });
    expect(notes[1]).toMatchObject({ text: "Pages are live.", aside: "Logan" });
  });

  it("sets a day-only record on his own day, under the notes with a time", () => {
    const notes = todayNotes({ show: { done: [item("a", "Landed today", "2026-11-07")], landedWeek: [item("b", "Timed", at(9))] } }, NOW);
    expect(notes.map((note) => note.text)).toEqual(["Timed", "Landed today"]);
  });
});

describe("the news desk", () => {
  const edition = { date: "2026-11-03", items: [
    { n: 1, title: "Static Radio", url: "https://hackaday.com/a", source: "Hackaday", why: "A radio." },
    { n: 2, title: "Sunset", url: "https://pexels.com/b", source: "Pexels" },
    { n: 3, title: "Dance", url: "https://giphy.com/c", source: "Giphy" },
    { n: 4, title: "Trending", url: "https://trends.google.com/d", source: "Google Trends" },
  ] };

  it("keeps the latest edition whatever its day, without the stock-picture and trend filler", () => {
    const desk = newsDeskOf(edition);
    expect(desk?.updated).toBe("2026-11-03");
    expect(desk?.stories.map((story) => story.title)).toEqual(["Static Radio"]);
  });

  it("has nothing to show when the edition is filler or missing", () => {
    expect(newsDeskOf({ date: "2026-11-03", items: [edition.items[1]] })).toBeNull();
    expect(newsDeskOf(null)).toBeNull();
  });
});

describe("the forecast for the weather card", () => {
  const raw = {
    current: { temperature_2m: 29.4, weather_code: 0, time: "2026-11-07T20:15", is_day: 0 },
    hourly: { time: ["2026-11-07T20:00", "2026-11-07T21:00"], temperature_2m: [29, 28], precipitation_probability: [65, 97], weather_code: [61, 2], is_day: [0, 0] },
    daily: { time: ["2026-11-07", "2026-11-08"], weather_code: [61, 95], temperature_2m_max: [30, 29], temperature_2m_min: [24, 25] },
  };

  it("gives each hour its code and night, and the days after today", () => {
    const reading = parseWeather(raw, { lat: -8.6, lon: 115.1, name: "Canggu" }, NOW)!;
    expect(reading.night).toBe(true);
    expect(reading.hours[1]).toMatchObject({ code: 2, night: true, rainChance: 97 });
    expect(reading.days).toEqual([{ day: "2026-11-08", code: 95, highC: 29, lowC: 25 }]);
  });

  it("asks for six days with codes", () => {
    const url = forecastUrl({ lat: 1, lon: 2 });
    expect(url).toContain("forecast_days=6");
    expect(decodeURIComponent(url)).toContain("hourly=temperature_2m,precipitation_probability,weather_code,is_day");
  });

  it("finds the place his profile says he is in, the latest one, and never guesses", () => {
    expect(placeNameFromProfile("- George is in Bali. (2026-01-01)\n- George is in Canggu. (2026-10-14)\n")).toBe("Canggu");
    expect(placeNameFromProfile("George likes Canggu.")).toBeUndefined();
    expect(parseGeocode({ results: [{ latitude: -8.6, longitude: 115.1, name: "Canggu" }] }, "x")).toEqual({ lat: -8.6, lon: 115.1, name: "Canggu" });
    expect(parseGeocode({}, "x")).toBeNull();
  });

  it("keeps the last good reading through a failed fetch", async () => {
    let fail = false;
    const reader = new WeatherReader({ place: async () => ({ lat: 1, lon: 2 }), fetch: async () => { if (fail) throw new Error("down"); return raw; } });
    await reader.refresh();
    fail = true;
    expect((await reader.refresh())?.tempC).toBe(29.4);
  });
});

describe("the horoscope", () => {
  const page = `<div class="main-horoscope"><div>x</div><p><strong>Nov 6, 2026</strong> - Minor tensions could arise today, Virgo. People close to you aren&#39;t fair. Will you negotiate? The second seems likely.</p></div>`;

  it("reads his sign from his profile, and only a real sign", () => {
    expect(signFromProfile("- George's star sign is Virgo. (2026-10-26)")).toBe("virgo");
    expect(signFromProfile("star sign is Banana")).toBeUndefined();
  });

  it("keeps two sentences, dated and credited", () => {
    expect(parseHoroscope(page, "virgo")).toMatchObject({ sign: "Virgo", day: "2026-11-06", source: "Horoscope.com", text: "Minor tensions could arise today, Virgo. People close to you aren't fair." });
  });

  it("says nothing when the page has changed shape", () => {
    expect(parseHoroscope("<p>hello</p>", "virgo")).toBeNull();
  });
});
