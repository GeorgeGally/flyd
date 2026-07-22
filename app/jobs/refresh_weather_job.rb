class RefreshWeatherJob < ApplicationJob
  class ConfigurationError < StandardError; end

  queue_as :default

  LOCK_KEY = "weather:refresh_enqueued"
  LOCK_TTL = 30.minutes

  retry_on StandardError, wait: :polynomially_longer, attempts: 3

  def self.enqueue
    return false unless Rails.application.config_for(:flyd)[:weather_location].present?

    snapshot = IntelligenceSnapshot.latest_for(IntelligenceState::WeatherProvider::PROVIDER)
    return false if snapshot&.fresh?
    return false unless Rails.cache.write(LOCK_KEY, true, expires_in: LOCK_TTL, unless_exist: true)

    perform_later
    true
  rescue ActiveJob::EnqueueError
    Rails.cache.delete(LOCK_KEY)
    raise
  end

  def perform
    location = configured_location
    forecast = evidence_for(client.fetch(latitude: location.fetch(:latitude), longitude: location.fetch(:longitude)), location:)
    _record, changed = provider.persist!(forecasts: [ forecast ])
    ComposeSurfaceJob.enqueue(reason: "weather_refresh") if changed || Surface.current.nil? || Surface.current.stale?
    Rails.cache.delete(LOCK_KEY)
  rescue StandardError => error
    provider.record_failure!(error)
    Rails.cache.delete(LOCK_KEY)
    raise
  end

  private

  def configuration
    @configuration ||= Rails.application.config_for(:flyd)
  end

  def configured_location
    raw = configuration[:weather_location].to_s
    parts = raw.split(",", 3).map(&:strip)
    latitude = Float(parts[0], exception: false)
    longitude = Float(parts[1], exception: false)
    raise ConfigurationError, "Weather location is not configured. Set FLYD_WEATHER_LOCATION to latitude,longitude,label." unless latitude && longitude

    { latitude: latitude, longitude: longitude, label: parts[2].presence || "#{latitude}, #{longitude}" }
  end

  def client
    @client ||= Weather::OpenMeteoClient.new
  end

  def provider
    @provider ||= IntelligenceState::WeatherProvider.new
  end

  def evidence_for(payload, location:)
    current = payload.fetch(:current)
    current_units = payload[:current_units].to_h
    daily = payload[:daily].to_h
    daily_units = payload[:daily_units].to_h
    observed_at = Time.zone.parse(current.fetch(:time).to_s)
    temperature = current.fetch(:temperature_2m)
    temperature_unit = current_units[:temperature_2m].presence || "°C"
    condition = condition_for(current[:weather_code])
    description = "#{temperature}#{temperature_unit} and #{condition.downcase} in #{location.fetch(:label)}."

    {
      "id" => "forecast:weather:#{location.fetch(:latitude)}:#{location.fetch(:longitude)}:#{observed_at.iso8601}",
      "type" => "forecast",
      "source" => "weather",
      "epistemicStatus" => "observation",
      "confidence" => 0.95,
      "generatedAt" => observed_at.iso8601,
      "evidenceRefs" => [],
      "content" => {
        "title" => "#{location.fetch(:label)} weather",
        "description" => description,
        "temperature" => temperature,
        "temperatureUnit" => temperature_unit,
        "apparentTemperature" => current[:apparent_temperature],
        "apparentTemperatureUnit" => current_units[:apparent_temperature],
        "humidity" => current[:relative_humidity_2m],
        "precipitation" => current[:precipitation],
        "precipitationUnit" => current_units[:precipitation],
        "windSpeed" => current[:wind_speed_10m],
        "windSpeedUnit" => current_units[:wind_speed_10m],
        "condition" => condition,
        "weatherCode" => current[:weather_code],
        "locationLabel" => location.fetch(:label),
        "latitude" => location.fetch(:latitude),
        "longitude" => location.fetch(:longitude),
        "timezone" => payload[:timezone],
        "observedAt" => observed_at.iso8601,
        "high" => Array(daily[:temperature_2m_max]).first,
        "highUnit" => daily_units[:temperature_2m_max],
        "low" => Array(daily[:temperature_2m_min]).first,
        "lowUnit" => daily_units[:temperature_2m_min],
        "precipitationProbability" => Array(daily[:precipitation_probability_max]).first,
        "precipitationProbabilityUnit" => daily_units[:precipitation_probability_max]
      }.compact
    }
  end

  def condition_for(code)
    case code.to_i
    when 0 then "Clear"
    when 1 then "Mainly clear"
    when 2 then "Partly cloudy"
    when 3 then "Overcast"
    when 45, 48 then "Fog"
    when 51, 53, 55 then "Drizzle"
    when 56, 57 then "Freezing drizzle"
    when 61, 63, 65 then "Rain"
    when 66, 67 then "Freezing rain"
    when 71, 73, 75, 77 then "Snow"
    when 80, 81, 82 then "Rain showers"
    when 85, 86 then "Snow showers"
    when 95, 96, 99 then "Thunderstorm"
    else "Unknown conditions"
    end
  end
end
