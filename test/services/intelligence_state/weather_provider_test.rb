require "test_helper"

class IntelligenceState::WeatherProviderTest < ActiveSupport::TestCase
  test "persists and reads forecast evidence" do
    provider = IntelligenceState::WeatherProvider.new
    record, changed = provider.persist!(forecasts: [ forecast_evidence ])
    snapshot = provider.snapshot

    assert changed
    assert_equal record.id, snapshot.snapshot_id
    assert snapshot.fresh
    assert_empty snapshot.errors
    assert_equal "Makassar weather", snapshot.data[:forecasts].first.dig("content", "title")
  end

  test "retains usable forecast while exposing a later refresh failure" do
    provider = IntelligenceState::WeatherProvider.new
    usable, = provider.persist!(forecasts: [ forecast_evidence ])
    provider.record_failure!(RuntimeError.new("weather location is not configured"))

    snapshot = provider.snapshot

    assert snapshot.fresh
    assert_equal usable.id, snapshot.snapshot_id
    assert_equal [ "weather location is not configured" ], snapshot.errors
  end

  private

  def forecast_evidence
    {
      "id" => "forecast:weather:-5.1477:119.4327:2026-07-22T06:00:00Z",
      "type" => "forecast",
      "source" => "weather",
      "epistemicStatus" => "observation",
      "confidence" => 0.95,
      "generatedAt" => Time.current.iso8601,
      "evidenceRefs" => [],
      "content" => {
        "title" => "Makassar weather",
        "description" => "28°C and partly cloudy.",
        "temperature" => 28,
        "temperatureUnit" => "°C",
        "condition" => "Partly cloudy",
        "locationLabel" => "Makassar"
      }
    }
  end
end
