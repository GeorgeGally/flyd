require "test_helper"

class WebDiscovery::FeedClientTest < ActiveSupport::TestCase
  test "normalizes RSS and Atom entries into grounded stories" do
    sources = [
      { name: "Example News", url: "https://news.example/feed", kind: "publisher", category: "technology" },
      { name: "r/creativecoding", url: "https://www.reddit.com/r/creativecoding/.rss", kind: "reddit", category: "creative_coding" }
    ]
    responses = {
      "https://news.example/feed" => rss_fixture,
      "https://www.reddit.com/r/creativecoding/.rss" => atom_fixture
    }
    transport = ->(uri, **) { responses.fetch(uri.to_s) }

    stories = WebDiscovery::FeedClient.new(sources:, transport:).fetch

    assert_equal 2, stories.length
    rss = stories.find { |story| story[:source_name] == "Example News" }
    assert_equal "A useful systems story", rss[:title]
    assert_equal "https://news.example/articles/systems", rss[:url]
    assert_equal "A specific account of a useful system.", rss[:description]
    assert_equal "https://news.example/images/systems.jpg", rss[:image_url]
    assert_equal "publisher", rss[:source_kind]

    atom = stories.find { |story| story[:source_kind] == "reddit" }
    assert_equal "A new p5.js instrument", atom[:title]
    assert_equal "https://www.reddit.com/r/creativecoding/comments/abc/instrument/", atom[:discussion_url]
    assert_equal "creative_coding", atom[:source_category]
    assert atom[:published_at].is_a?(Time)
  end

  test "uses stable identifiers and isolates a failed source" do
    sources = [
      { name: "Broken", url: "https://broken.example/feed", kind: "publisher", category: "technology" },
      { name: "Working", url: "https://working.example/feed", kind: "publisher", category: "technology" }
    ]
    transport = lambda do |uri, **|
      raise Timeout::Error, "slow feed" if uri.host == "broken.example"

      rss_fixture
    end
    client = WebDiscovery::FeedClient.new(sources:, transport:)

    first = client.fetch
    second = client.fetch

    assert_equal 1, first.length
    assert_equal first.first[:id], second.first[:id]
    assert_equal "Working", first.first[:source_name]
  end

  test "permits large publisher feeds within the bounded response limit" do
    source = { name: "Magazine", url: "https://magazine.example/feed", kind: "publisher", category: "design" }
    received_limit = nil
    transport = lambda do |_uri, max_bytes:, **|
      received_limit = max_bytes
      rss_fixture
    end

    WebDiscovery::FeedClient.new(sources: [ source ], transport:).fetch

    assert_equal 2.megabytes, received_limit
  end

  test "reads legacy RSS links and descriptions from guid and content encoded" do
    source = { name: "Uncrate", url: "https://feeds.feedburner.com/uncrate", kind: "publisher", category: "design" }
    transport = ->(*) { legacy_rss_fixture }

    story = WebDiscovery::FeedClient.new(sources: [ source ], transport:).fetch.first

    assert_equal "Rivian x Nike ACG R1T Recharge Truck", story[:title]
    assert_equal "https://uncrate.com/rivian-x-nike-acg-r1t-recharge-truck/", story[:url]
    assert_equal "Nike ACG and Rivian built a shade truck for a trail race.", story[:description]
    assert_equal "https://uncrate.com/recharge-truck.jpg", story[:image_url]
  end

  private

  def rss_fixture
    <<~XML
      <?xml version="1.0"?>
      <rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
        <channel>
          <item>
            <title>A useful systems story</title>
            <link>https://news.example/articles/systems</link>
            <guid>systems-42</guid>
            <pubDate>Tue, 14 Jul 2026 10:00:00 GMT</pubDate>
            <description><![CDATA[<p>A specific account of a useful system.</p>]]></description>
            <media:content url="https://news.example/images/systems.jpg" medium="image" />
          </item>
        </channel>
      </rss>
    XML
  end

  def atom_fixture
    <<~XML
      <?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <entry>
          <title>A new p5.js instrument</title>
          <id>t3_abc</id>
          <updated>2026-07-14T09:00:00Z</updated>
          <author><name>maker</name></author>
          <link href="https://www.reddit.com/r/creativecoding/comments/abc/instrument/" />
          <content type="html">&lt;div&gt;&lt;p&gt;A playable audiovisual instrument built with p5.js.&lt;/p&gt;&lt;/div&gt;</content>
        </entry>
      </feed>
    XML
  end

  def legacy_rss_fixture
    <<~XML
      <?xml version="1.0"?>
      <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <channel>
          <item>
            <title>Rivian x Nike ACG R1T Recharge Truck</title>
            <guid>https://uncrate.com/rivian-x-nike-acg-r1t-recharge-truck/</guid>
            <pubDate>Tue, 14 Jul 2026 18:00:00 -0500</pubDate>
            <description></description>
            <content:encoded><![CDATA[<p>Nike ACG and Rivian built a shade truck for a trail race.</p>]]></content:encoded>
            <enclosure type="image/jpg" url="https://uncrate.com/recharge-truck.jpg" />
          </item>
        </channel>
      </rss>
    XML
  end
end
