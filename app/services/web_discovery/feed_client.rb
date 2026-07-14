require "digest"
require "net/http"
require "nokogiri"
require "uri"

module WebDiscovery
  class FeedClient
    OPEN_TIMEOUT = 3
    READ_TIMEOUT = 5
    MAX_BYTES = 2.megabytes
    DEFAULT_PER_SOURCE_LIMIT = 5

    def initialize(sources: FeedCatalog.sources, transport: nil, per_source_limit: DEFAULT_PER_SOURCE_LIMIT)
      @sources = sources.map { |source| source.to_h.symbolize_keys }
      @transport = transport || method(:get_xml)
      @per_source_limit = per_source_limit
    end

    def fetch
      @sources.flat_map { |source| fetch_source(source) }
    end

    private

    def fetch_source(source)
      uri = source_uri(source)
      xml = @transport.call(uri, open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT, max_bytes: MAX_BYTES)
      document = Nokogiri::XML(xml.to_s) { |config| config.nonet.recover }
      entries(document).first(@per_source_limit).filter_map { |entry| normalize(entry, source, uri) }
    rescue StandardError => error
      Rails.logger.warn("Feed refresh failed for #{source[:name]}: #{error.message}")
      []
    end

    def entries(document)
      rss = document.xpath("//*[local-name()='item']")
      rss.any? ? rss : document.xpath("//*[local-name()='entry']")
    end

    def normalize(entry, source, feed_uri)
      title = node_text(entry, "title")
      url = entry_url(entry)
      return if title.blank? || url.blank?

      guid = node_text(entry, "guid", "id").presence || url
      published_at = parsed_time(node_text(entry, "pubDate", "published", "updated", "date")) || Time.current
      html = node_text(entry, "description", "summary", "content")
      description = clean_html(html)
      image_url = absolute_url(feed_uri, entry_image(entry, html))
      reddit = source[:kind] == "reddit"

      {
        id: Digest::SHA256.hexdigest("#{source[:name]}|#{guid}").first(20),
        title: title,
        url: url,
        discussion_url: reddit ? url : nil,
        author: node_text(entry, "creator") || entry.at_xpath(".//*[local-name()='author']/*[local-name()='name']")&.text&.squish,
        score: freshness_score(published_at),
        comments: nil,
        published_at: published_at,
        description: description,
        image_url: image_url,
        site_name: source[:name],
        source_name: source[:name],
        source_key: source[:name].to_s.parameterize,
        source_kind: source[:kind],
        source_category: source[:category].to_s
      }.compact
    end

    def node_text(entry, *names)
      names.lazy.filter_map do |name|
        entry.at_xpath("./*[local-name()='#{name}']")&.text&.squish.presence
      end.first
    end

    def entry_url(entry)
      link = entry.xpath("./*[local-name()='link']").find do |node|
        node["rel"].blank? || node["rel"] == "alternate"
      end
      safe_url(link&.[]("href").presence || link&.text)
    end

    def entry_image(entry, html)
      media = entry.at_xpath(".//*[local-name()='content' or local-name()='thumbnail'][@url]")&.[]("url")
      enclosure = entry.at_xpath(".//*[local-name()='enclosure'][starts-with(@type, 'image/')]")&.[]("url")
      embedded = Nokogiri::HTML.fragment(html.to_s).at_css("img")&.[]("src")
      media.presence || enclosure.presence || embedded.presence
    end

    def clean_html(value)
      Nokogiri::HTML.fragment(value.to_s).text.squish.presence&.truncate(500)
    end

    def source_uri(source)
      uri = URI.parse(source.fetch(:url))
      raise ArgumentError, "Feed URLs must use HTTPS" unless uri.scheme == "https" && uri.host.present?

      uri
    end

    def safe_url(value)
      uri = URI.parse(value.to_s)
      uri.to_s if uri.scheme.in?(%w[http https]) && uri.host.present?
    rescue URI::InvalidURIError
      nil
    end

    def absolute_url(base_uri, value)
      return if value.blank?

      safe_url(URI.join(base_uri.to_s, value.to_s).to_s)
    rescue URI::InvalidURIError
      nil
    end

    def parsed_time(value)
      Time.zone.parse(value.to_s) if value.present?
    rescue ArgumentError, TypeError
      nil
    end

    def freshness_score(published_at)
      age = [ (Time.current - published_at) / 1.hour, 0 ].max
      [ 1_000 - age.round, 0 ].max
    end

    def get_xml(uri, open_timeout:, read_timeout:, max_bytes:)
      response = Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout:, read_timeout:) do |http|
        http.get(uri.request_uri, { "Accept" => "application/rss+xml, application/atom+xml, application/xml, text/xml", "User-Agent" => "Flyd/1.0 RSS reader" })
      end
      raise "Feed returned #{response.code}" unless response.is_a?(Net::HTTPSuccess)
      raise "Feed is too large" if response.body.bytesize > max_bytes

      response.body
    end
  end
end
