import { describe, expect, it } from "vitest";
import { conditionOf, forecastUrl, parseWeather, placeFrom, WeatherReader } from "../weather.js";

const FORECAST = {
  current: { time: "2026-10-10T11:00", temperature_2m: 29.4, weather_code: 2 },
  hourly: {
    time: ["2026-10-10T10:00", "2026-10-10T11:00", "2026-10-10T12:00"],
    temperature_2m: [28, 29, 30],
    precipitation_probability: [5, 10, 70],
  },
};

describe("weather", () => {
  it("reads a place from lat,lon[,name]", () => {
    expect(placeFrom("-8.65,115.13,Canggu")).toEqual({ lat: -8.65, lon: 115.13, name: "Canggu" });
    expect(placeFrom("-8.65,115.13")).toEqual({ lat: -8.65, lon: 115.13 });
    expect(placeFrom("somewhere")).toBeNull();
    expect(placeFrom(undefined)).toBeNull();
  });

  it("starts the hours at the current one", () => {
    const reading = parseWeather(FORECAST, { lat: 0, lon: 0, name: "Canggu" }, Date.parse("2026-10-10T04:00:00Z"))!;
    expect(reading).toMatchObject({ place: "Canggu", tempC: 29.4, condition: "partly cloudy" });
    expect(reading.hours).toEqual([
      { at: "2026-10-10T11:00", tempC: 29, rainChance: 10 },
      { at: "2026-10-10T12:00", tempC: 30, rainChance: 70 },
    ]);
  });

  it("reads the week: each day's high, low and sky, today's next six hours every other hour, later days every three", () => {
    const times: string[] = [];
    const temps: number[] = [];
    for (const date of ["2026-11-07", "2026-11-08"]) for (let hour = 0; hour < 24; hour += 1) { times.push(`${date}T${String(hour).padStart(2, "0")}:00`); temps.push(20 + hour / 2); }
    const reading = parseWeather({
      current: { time: "2026-11-07T13:00", temperature_2m: 29.2, weather_code: 0 },
      hourly: { time: times, temperature_2m: temps, precipitation_probability: times.map(() => 40), weather_code: times.map(() => 61) },
      daily: { time: ["2026-11-07", "2026-11-08"], weather_code: [61, 95], temperature_2m_max: [29, 30.4], temperature_2m_min: [25, 24] },
    }, { lat: 0, lon: 0, name: "Canggu" })!;
    expect(reading.localTime).toBe("13:00");
    expect(reading.days!.map((day) => [day.date, day.code, day.hiC, day.loC])).toEqual([["2026-11-07", 61, 29, 25], ["2026-11-08", 95, 30.4, 24]]);
    // Late in the day, today's hours run on past midnight rather than leave the row half empty.
    expect(reading.days![0]!.hours.map((hour) => hour.at.slice(11))).toEqual(["14:00", "16:00", "18:00", "20:00", "22:00", "00:00"]);
    expect(reading.days![1]!.hours.map((hour) => hour.at.slice(11))).toEqual(["06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]);
    expect(reading.days![1]!.hours[0]).toEqual({ at: "2026-11-08T06:00", tempC: 23, rainChance: 40, code: 61 });
  });

  it("asks Open-Meteo for the week and each hour's sky", () => {
    const url = new URL(forecastUrl({ lat: -8.65, lon: 115.13 }));
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(url.searchParams.get("latitude")).toBe("-8.65");
    expect(url.searchParams.get("longitude")).toBe("115.13");
    expect(url.searchParams.get("forecast_days")).toBe("7");
    expect(url.searchParams.get("timezone")).toBe("auto");
    expect(new Set(url.searchParams.get("current")?.split(","))).toEqual(new Set(["temperature_2m", "weather_code"]));
    expect(new Set(url.searchParams.get("daily")?.split(","))).toEqual(new Set(["weather_code", "temperature_2m_max", "temperature_2m_min"]));
    expect(new Set(url.searchParams.get("hourly")?.split(","))).toEqual(new Set(["temperature_2m", "precipitation_probability", "weather_code"]));
  });

  it("is not a reading without current conditions", () => {
    expect(parseWeather({}, { lat: 0, lon: 0 })).toBeNull();
  });

  it("names WMO codes plainly", () => {
    expect([0, 3, 61, 81, 95].map(conditionOf)).toEqual(["clear", "overcast", "rain", "showers", "thunderstorms"]);
  });

  it("has no reading without a place, rather than a guessed one", async () => {
    const reader = new WeatherReader({ place: async () => null, fetch: async () => FORECAST });
    expect(await reader.refresh()).toBeNull();
  });

  it("keeps the last good reading when a fetch fails", async () => {
    let fail = false;
    const reader = new WeatherReader({
      place: async () => ({ lat: 0, lon: 0 }),
      fetch: async () => {
        if (fail) throw new Error("offline");
        return FORECAST;
      },
    });
    await reader.refresh();
    fail = true;
    expect((await reader.refresh())?.tempC).toBe(29.4);
  });
});
