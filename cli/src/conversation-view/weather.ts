import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FLYD_DIR } from "../lib/config.js";

// The weather where George is, for the artefact's weather box and the News
// tab's weather card (today, the week ahead, a few hours of each day). Open-Meteo:
// no key, no account. The place comes from FLYD_WEATHER_LOCATION
// ("lat,lon[,name]") or ~/.flyd/location.json ({ "lat", "lon", "name" }); with
// neither there is no weather box rather than a guessed place. Never read
// under vitest.

export interface WeatherPlace {
  lat: number;
  lon: number;
  name?: string;
}

export interface WeatherHour {
  /** Local time, ISO without offset, as Open-Meteo gives it. */
  at: string;
  tempC: number;
  /** Chance of rain that hour, 0–100. */
  rainChance: number;
  /** WMO weather code for that hour, when the forecast has one. */
  code?: number;
}

/** One day of the week ahead: its high and low, its sky, and a few hours across it. */
export interface WeatherDay {
  /** Local date, YYYY-MM-DD. */
  date: string;
  code: number;
  hiC: number;
  loC: number;
  /** Today: six hours, every other one from the next. Later days: 06:00 to 21:00, every three hours. */
  hours: WeatherHour[];
}

export interface WeatherReading {
  place?: string;
  tempC: number;
  /** WMO weather code, for a one-word condition. */
  code: number;
  condition: string;
  /** The next twelve hours, from the current hour. */
  hours: WeatherHour[];
  /** Today and the six days after it, when the forecast has them. */
  days?: WeatherDay[];
  /** The forecast's own clock where he is, "HH:MM", when it says. */
  localTime?: string;
  read: string;
}

const REFRESH_MS = 30 * 60 * 1000;

/** WMO weather codes in a word or two. */
export function conditionOf(code: number): string {
  if (code === 0) return "clear";
  if (code <= 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 80 && code <= 82) return "showers";
  if (code >= 95) return "thunderstorms";
  return "mixed";
}

export function placeFrom(value: string | undefined): WeatherPlace | null {
  if (!value) return null;
  const [lat, lon, ...name] = value.split(",").map((part) => part.trim());
  const place = { lat: Number(lat), lon: Number(lon) };
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return null;
  return name.length && name.join(",") ? { ...place, name: name.join(", ") } : place;
}

/** Open-Meteo's forecast JSON as a reading, or null when it is not one. Pure. */
export function parseWeather(raw: unknown, place: WeatherPlace, now = Date.now()): WeatherReading | null {
  const body = raw as {
    current?: { temperature_2m?: unknown; weather_code?: unknown; time?: unknown };
    hourly?: { time?: unknown; temperature_2m?: unknown; precipitation_probability?: unknown; weather_code?: unknown };
    daily?: { time?: unknown; weather_code?: unknown; temperature_2m_max?: unknown; temperature_2m_min?: unknown };
  };
  const temp = body?.current?.temperature_2m;
  const code = body?.current?.weather_code;
  if (typeof temp !== "number" || typeof code !== "number") return null;
  const times = Array.isArray(body.hourly?.time) ? (body.hourly!.time as unknown[]) : [];
  const temps = Array.isArray(body.hourly?.temperature_2m) ? (body.hourly!.temperature_2m as unknown[]) : [];
  const rain = Array.isArray(body.hourly?.precipitation_probability) ? (body.hourly!.precipitation_probability as unknown[]) : [];
  const codes = Array.isArray(body.hourly?.weather_code) ? (body.hourly!.weather_code as unknown[]) : [];
  const hourAt = (index: number): WeatherHour | null => {
    const at = times[index];
    const tempC = temps[index];
    if (typeof at !== "string" || typeof tempC !== "number") return null;
    const chance = rain[index];
    const sky = codes[index];
    return { at, tempC, rainChance: typeof chance === "number" ? chance : 0, ...(typeof sky === "number" ? { code: sky } : {}) };
  };
  const currentHour = typeof body.current?.time === "string" ? body.current.time.slice(0, 13) : undefined;
  const start = Math.max(0, currentHour ? times.findIndex((time) => typeof time === "string" && time.slice(0, 13) === currentHour) : 0);
  const hours: WeatherHour[] = [];
  for (let index = start; index < times.length && hours.length < 12; index += 1) {
    const hour = hourAt(index);
    if (hour) hours.push(hour);
  }
  const days = daysOf(body.daily, times, hourAt, start);
  const localTime = typeof body.current?.time === "string" && /T\d{2}:\d{2}/.test(body.current.time) ? body.current.time.slice(11, 16) : undefined;
  return {
    ...(place.name ? { place: place.name } : {}),
    tempC: temp,
    code,
    condition: conditionOf(code),
    hours,
    ...(days.length ? { days } : {}),
    ...(localTime ? { localTime } : {}),
    read: new Date(now).toISOString(),
  };
}

const LATER_HOURS = ["06", "09", "12", "15", "18", "21"];

/** The week ahead from Open-Meteo's daily block, each day with the hours the card shows. Pure. */
function daysOf(
  daily: { time?: unknown; weather_code?: unknown; temperature_2m_max?: unknown; temperature_2m_min?: unknown } | undefined,
  times: unknown[],
  hourAt: (index: number) => WeatherHour | null,
  start: number,
): WeatherDay[] {
  const dates = Array.isArray(daily?.time) ? (daily!.time as unknown[]) : [];
  const codes = Array.isArray(daily?.weather_code) ? (daily!.weather_code as unknown[]) : [];
  const highs = Array.isArray(daily?.temperature_2m_max) ? (daily!.temperature_2m_max as unknown[]) : [];
  const lows = Array.isArray(daily?.temperature_2m_min) ? (daily!.temperature_2m_min as unknown[]) : [];
  const days: WeatherDay[] = [];
  dates.slice(0, 7).forEach((date, index) => {
    const code = codes[index];
    const hiC = highs[index];
    const loC = lows[index];
    if (typeof date !== "string" || typeof code !== "number" || typeof hiC !== "number" || typeof loC !== "number") return;
    const hours: WeatherHour[] = [];
    if (index === 0) {
      for (let at = start + 1; at < times.length && hours.length < 6; at += 2) {
        const hour = hourAt(at);
        if (hour && hour.at.slice(0, 10) === date) hours.push(hour);
      }
    } else {
      for (const hh of LATER_HOURS) {
        const at = times.findIndex((time) => time === `${date}T${hh}:00`);
        const hour = at >= 0 ? hourAt(at) : null;
        if (hour) hours.push(hour);
      }
    }
    days.push({ date, code, hiC, loC, hours });
  });
  return days;
}

type Fetcher = (url: string) => Promise<unknown>;

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`weather ${response.status}`);
  return response.json();
}

async function placeOnDisk(): Promise<WeatherPlace | null> {
  try {
    const raw = JSON.parse(await readFile(join(FLYD_DIR, "location.json"), "utf8")) as { lat?: unknown; lon?: unknown; name?: unknown };
    if (typeof raw.lat !== "number" || typeof raw.lon !== "number") return null;
    return { lat: raw.lat, lon: raw.lon, ...(typeof raw.name === "string" ? { name: raw.name } : {}) };
  } catch {
    return null;
  }
}

export function forecastUrl(place: WeatherPlace): string {
  const query = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: "temperature_2m,weather_code",
    hourly: "temperature_2m,precipitation_probability,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    forecast_days: "7",
    timezone: "auto",
  });
  return `https://api.open-meteo.com/v1/forecast?${query}`;
}

/** Keeps the latest reading, refreshed in the background. */
export class WeatherReader {
  private latest: WeatherReading | null = null;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly options: { place?: () => Promise<WeatherPlace | null>; fetch?: Fetcher } = {},
  ) {}

  start(): void {
    if (process.env.VITEST || this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async refresh(): Promise<WeatherReading | null> {
    const place = await (this.options.place ?? (async () => placeFrom(process.env.FLYD_WEATHER_LOCATION) ?? placeOnDisk()))();
    if (!place) {
      this.latest = null;
      return null;
    }
    try {
      this.latest = parseWeather(await (this.options.fetch ?? fetchJson)(forecastUrl(place)), place);
    } catch {
      // Keep the last good reading; the box shows its age.
    }
    return this.latest;
  }

  current(): WeatherReading | null {
    return this.latest;
  }
}
