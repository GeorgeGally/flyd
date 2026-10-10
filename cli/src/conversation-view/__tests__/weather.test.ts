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

  it("is not a reading without current conditions", () => {
    expect(parseWeather({}, { lat: 0, lon: 0 })).toBeNull();
  });

  it("names WMO codes plainly", () => {
    expect([0, 3, 61, 81, 95].map(conditionOf)).toEqual(["clear", "overcast", "rain", "showers", "thunderstorms"]);
  });

  it("asks Open-Meteo for local time", () => {
    expect(forecastUrl({ lat: -8.65, lon: 115.13 })).toContain("timezone=auto");
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
