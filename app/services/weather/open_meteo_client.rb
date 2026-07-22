require "json"
require "net/http"
require "uri"

module Weather
  class OpenMeteoClient
    ENDPOINT = "https://api.open-meteo.com/v1/forecast"
    TIMEOUT = 10

    def fetch(latitude:, longitude:)
      uri = URI(ENDPOINT)
      uri.query = URI.encode_www_form(
        latitude: latitude,
        longitude: longitude,
        current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
        daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
        timezone: "auto",
        forecast_days: 1
      )

      response = Net::HTTP.start(uri.host, uri.port, use_ssl: true, read_timeout: TIMEOUT, open_timeout: TIMEOUT) do |http|
        http.get(uri)
      end
      raise "Open-Meteo weather request failed: #{response.code}" unless response.is_a?(Net::HTTPSuccess)

      JSON.parse(response.body).deep_symbolize_keys
    end
  end
end
