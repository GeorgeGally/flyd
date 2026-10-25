require "net/http"
require "nokogiri"
require "uri"

module Horoscope
  class Client
    SIGNS = %w[aries taurus gemini cancer leo virgo libra scorpio sagittarius capricorn aquarius pisces].freeze
    OPEN_TIMEOUT = 3
    READ_TIMEOUT = 5
    MAX_BYTES = 512.kilobytes

    def initialize(sign:, transport: nil)
      @sign = sign.to_s.downcase
      raise ArgumentError, "Unsupported zodiac sign" unless SIGNS.include?(@sign)

      @transport = transport || method(:get_html)
    end

    def fetch
      uri = URI.parse("https://www.astrology.com/horoscope/daily/#{@sign}.html")
      html = @transport.call(uri, open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT, max_bytes: MAX_BYTES)
      document = Nokogiri::HTML(html.to_s)
      description = document.at_css(".horoscope-content-wrapper #content")&.text&.squish
      date = Date.parse(document.at_css(".horoscope-content-wrapper #content-date")&.text.to_s)
      raise "Current horoscope content is unavailable" if description.blank?

      {
        sign: @sign.capitalize,
        date: date,
        description: description,
        author: document.at_css(".byline a")&.text&.squish.presence,
        url: uri.to_s
      }.compact
    end

    private

    def get_html(uri, open_timeout:, read_timeout:, max_bytes:)
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout:, read_timeout:) do |http|
        http.get(uri.request_uri, { "Accept" => "text/html", "User-Agent" => "Flyd/1.0" })
      end
      raise "Horoscope source returned #{response.code}" unless response.is_a?(Net::HTTPSuccess)
      raise "Horoscope source is too large" if response.body.bytesize > max_bytes

      response.body
    end
  end
end
