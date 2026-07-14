require "cgi"
require "ipaddr"
require "net/http"
require "nokogiri"
require "resolv"
require "timeout"
require "uri"

module WebDiscovery
  class PageMetadata
    Error = Class.new(StandardError)
    MAX_BYTES = 256.kilobytes
    OPEN_TIMEOUT = 2
    READ_TIMEOUT = 3
    MAX_REDIRECTS = 3
    BLOCKED_NETWORKS = %w[
      0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16
      172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.168.0.0/16 198.18.0.0/15
      198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4
      ::/128 ::1/128 fc00::/7 fe80::/10 ff00::/8
    ].map { |network| IPAddr.new(network) }.freeze

    def initialize(transport: nil, resolver: nil)
      @transport = transport || method(:get_html)
      @resolver = resolver || ->(host) { Resolv.getaddresses(host) }
    end

    def fetch(value)
      uri = public_uri(value)
      return {} unless uri

      response = @transport.call(uri, open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT, max_bytes: MAX_BYTES)
      html, final_uri = response.is_a?(Array) ? response : [ response, uri ]
      extract(html.to_s, final_uri)
    rescue StandardError
      {}
    end

    private

    def extract(html, uri)
      document = Nokogiri::HTML(html)
      metadata_description = clean_text(meta_content(document, "meta[property='og:description']", "meta[name='description']"))
      thesis = clean_text(document.at_css("article blockquote, main blockquote")&.text)
      description = select_description(metadata_description, thesis)
      description ||= clean_text(document.at_css("article p, main p")&.text)
      image = meta_content(document, "meta[property='og:image']", "meta[name='twitter:image']")
      site_name = meta_content(document, "meta[property='og:site_name']")

      {
        description: description&.truncate(360),
        image_url: absolute_public_url(uri, image),
        site_name: clean_text(site_name)&.truncate(120)
      }.compact_blank
    end

    def meta_content(document, *selectors)
      selectors.lazy.filter_map { |selector| document.at_css(selector)&.[]("content") }.first
    end

    def clean_text(value)
      text = CGI.unescapeHTML(value.to_s).squish
      text = text.sub(/\A(?:in [^,]{1,80},\s*)?it has been (?:reported|revealed|announced) that\s+/i, "")
      text = text.sub(/\A[a-z]/) { |character| character.upcase }
      text.presence
    end

    def select_description(metadata_description, thesis)
      return thesis if thesis&.length&.between?(40, 360) && (metadata_description.to_s.start_with?("Contents") || metadata_description.to_s.length > 420)

      metadata_description if meaningful_description?(metadata_description)
    end

    def meaningful_description?(value)
      value.to_s.length >= 40 && !value.to_s.match?(/\A(?:describe|description|untitled|home)\z/i)
    end

    def absolute_public_url(base_uri, value)
      return if value.blank?

      public_uri(URI.join(base_uri.to_s, value.to_s).to_s)&.to_s
    end

    def public_uri(value)
      uri = URI.parse(value.to_s)
      return unless uri.scheme.in?(%w[http https]) && uri.host.present?

      addresses = Array(@resolver.call(uri.host))
      return if addresses.empty? || addresses.any? { |address| blocked_address?(address) }

      uri
    rescue IPAddr::InvalidAddressError, Resolv::ResolvError
      nil
    end

    def blocked_address?(value)
      address = IPAddr.new(value)
      BLOCKED_NETWORKS.any? { |network| network.include?(address) }
    end

    def get_html(uri, open_timeout:, read_timeout:, max_bytes:, redirects: MAX_REDIRECTS)
      response = nil
      body = +""
      addresses = public_addresses(uri.host)
      raise Error, "Unsafe discovery address" if addresses.empty?

      http = Net::HTTP.new(uri.host, uri.port)
      http.ipaddr = addresses.first
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = open_timeout
      http.read_timeout = read_timeout
      http.start do |connection|
        request = Net::HTTP::Get.new(uri.request_uri, "Accept" => "text/html", "User-Agent" => "Flyd/1.0")
        connection.request(request) do |result|
          response = result
          if result.is_a?(Net::HTTPSuccess)
            raise Error, "Discovery page is not HTML" unless result["Content-Type"].to_s.include?("text/html")

            result.read_body do |chunk|
              body << chunk
              raise Error, "Discovery page is too large" if body.bytesize > max_bytes
            end
          end
        end
      end

      if response.is_a?(Net::HTTPRedirection)
        raise Error, "Too many discovery redirects" unless redirects.positive?

        redirected = public_uri(URI.join(uri.to_s, response.fetch("location")).to_s)
        raise Error, "Unsafe discovery redirect" unless redirected

        return get_html(redirected, open_timeout:, read_timeout:, max_bytes:, redirects: redirects - 1)
      end
      raise Error, "Discovery page returned #{response&.code}" unless response.is_a?(Net::HTTPSuccess)

      [ body, uri ]
    end

    def public_addresses(host)
      Array(@resolver.call(host)).reject { |address| blocked_address?(address) }
    end
  end
end
