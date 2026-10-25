require "json"
require "net/http"
require "uri"

module WebDiscovery
  class HackerNewsClient
    BASE_URL = "https://hacker-news.firebaseio.com/v0"
    DEFAULT_LIMIT = 20
    OPEN_TIMEOUT = 3
    READ_TIMEOUT = 5

    def initialize(transport: nil, limit: DEFAULT_LIMIT)
      @transport = transport || method(:get_json)
      @limit = [ limit.to_i, DEFAULT_LIMIT ].min
    end

    def fetch
      ids = Array(request("#{BASE_URL}/topstories.json"))
      ids.first(@limit).filter_map do |id|
        normalize(request("#{BASE_URL}/item/#{Integer(id)}.json"))
      rescue ArgumentError, TypeError
        nil
      end
    end

    private

    def request(url)
      uri = URI.parse(url)
      raise ArgumentError, "Unexpected discovery host" unless uri.scheme == "https" && uri.host == "hacker-news.firebaseio.com"

      @transport.call(uri, open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT)
    end

    def get_json(uri, open_timeout:, read_timeout:)
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: open_timeout, read_timeout: read_timeout) do |http|
        http.get(uri.request_uri, { "Accept" => "application/json", "User-Agent" => "Flyd/1.0" })
      end
      raise "Hacker News returned #{response.code}" unless response.is_a?(Net::HTTPSuccess)

      JSON.parse(response.body)
    end

    def normalize(raw)
      story = raw.to_h
      return unless story["type"] == "story" && story["title"].present?
      return if story["dead"] || story["deleted"]

      discussion_url = "https://news.ycombinator.com/item?id=#{story.fetch("id")}"
      {
        id: story.fetch("id"),
        title: story.fetch("title").to_s,
        url: safe_url(story["url"]) || discussion_url,
        discussion_url: discussion_url,
        author: story["by"].to_s,
        score: story["score"].to_i,
        comments: story["descendants"].to_i,
        published_at: Time.at(story["time"].to_i).utc
      }
    rescue KeyError
      nil
    end

    def safe_url(value)
      uri = URI.parse(value.to_s)
      uri.to_s if uri.scheme.in?(%w[http https]) && uri.host.present?
    rescue URI::InvalidURIError
      nil
    end
  end
end
