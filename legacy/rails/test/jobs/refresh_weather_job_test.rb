require "test_helper"

class RefreshWeatherJobTest < ActiveJob::TestCase
  setup do
    Rails.cache.delete(RefreshWeatherJob::LOCK_KEY) if defined?(RefreshWeatherJob::LOCK_KEY)
  end

  test "fetches configured location weather and queues composition" do
    client = Struct.new(:payload) { def fetch(latitude:, longitude:) = payload.merge(latitude:, longitude:) }.new(weather_payload)
    job = RefreshWeatherJob.new
    job.define_singleton_method(:configuration) do
      { weather_location: "-5.1477,119.4327,Makassar" }
    end
    job.define_singleton_method(:client) { client }
    calls = []

    ComposeSurfaceJob.stub(:enqueue, ->(**arguments) { calls << arguments }) do
      job.perform
    end

    snapshot = IntelligenceState::WeatherProvider.new.snapshot
    forecast = snapshot.data[:forecasts].first
    assert_equal "Makassar weather", forecast.dig("content", "title")
    assert_equal "Partly cloudy", forecast.dig("content", "condition")
    assert_equal "-5.1477", forecast.dig("content", "latitude").to_s
    assert_equal [ { reason: "weather_refresh" } ], calls
  end

  test "records a failure when location is not configured" do
    job = RefreshWeatherJob.new
    job.define_singleton_method(:configuration) { { weather_location: nil } }

    assert_raises(RefreshWeatherJob::ConfigurationError) { job.perform }

    snapshot = IntelligenceState::WeatherProvider.new.snapshot
    assert_match(/location/, snapshot.errors.first)
  end

  private

  def weather_payload
    {
      timezone: "Asia/Makassar",
      current: {
        time: "2026-07-22T06:00",
        temperature_2m: 28,
        relative_humidity_2m: 74,
        apparent_temperature: 31,
        precipitation: 0,
        weather_code: 2,
        wind_speed_10m: 11
      },
      current_units: {
        temperature_2m: "°C",
        apparent_temperature: "°C",
        precipitation: "mm",
        wind_speed_10m: "km/h"
      },
      daily: {
        time: [ "2026-07-22" ],
        temperature_2m_max: [ 31 ],
        temperature_2m_min: [ 24 ],
        precipitation_probability_max: [ 40 ]
      },
      daily_units: {
        temperature_2m_max: "°C",
        temperature_2m_min: "°C",
        precipitation_probability_max: "%"
      }
    }
  end
end
