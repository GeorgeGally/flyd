require "test_helper"

class WebDiscovery::PageMetadataTest < ActiveSupport::TestCase
  test "extracts a grounded description and absolute preview image" do
    html = <<~HTML
      <html><head>
        <meta property="og:description" content="  A useful article about visual intelligence.  ">
        <meta property="og:image" content="/preview.jpg">
        <meta property="og:site_name" content="Example Journal">
      </head></html>
    HTML
    transport = ->(_uri, **) { html }
    resolver = ->(_host) { [ "93.184.216.34" ] }

    result = WebDiscovery::PageMetadata.new(transport: transport, resolver: resolver).fetch("https://example.com/article")

    assert_equal "A useful article about visual intelligence.", result[:description]
    assert_equal "https://example.com/preview.jpg", result[:image_url]
    assert_equal "Example Journal", result[:site_name]
  end

  test "refuses private and non-http targets before transport" do
    calls = 0
    transport = ->(_uri, **) { calls += 1; "" }
    resolver = ->(_host) { [ "127.0.0.1" ] }
    client = WebDiscovery::PageMetadata.new(transport: transport, resolver: resolver)

    assert_empty client.fetch("http://localhost/private")
    assert_empty client.fetch("file:///etc/passwd")
    assert_equal 0, calls
  end

  test "prefers a concise article thesis over a verbose table-of-contents description" do
    html = <<~HTML
      <html><head>
        <meta name="description" content="Contents Introduction Background Details Conclusion This description keeps going without explaining the article clearly enough to earn the screen. It includes navigation and repeated section names before reaching the point.">
      </head><body><main>
        <blockquote>Tolstoyan art has the structure of a zero knowledge proof.</blockquote>
      </main></body></html>
    HTML
    transport = ->(_uri, **) { html }
    resolver = ->(_host) { [ "93.184.216.34" ] }

    result = WebDiscovery::PageMetadata.new(transport: transport, resolver: resolver).fetch("https://example.com/article")

    assert_equal "Tolstoyan art has the structure of a zero knowledge proof.", result[:description]
  end

  test "rejects placeholder descriptions that cannot explain the story" do
    html = "<html><head><meta name='description' content='describe'></head></html>"
    transport = ->(_uri, **) { html }
    resolver = ->(_host) { [ "93.184.216.34" ] }

    result = WebDiscovery::PageMetadata.new(transport: transport, resolver: resolver).fetch("https://example.com/article")

    assert_nil result[:description]
  end

  test "removes promotional attribution before the concrete claim" do
    html = <<~HTML
      <html><head>
        <meta name="description" content="In a real win for Earth Day, it has been reported that scientists recovered up to 90% of lithium from used EV batteries.">
      </head></html>
    HTML
    transport = ->(_uri, **) { html }
    resolver = ->(_host) { [ "93.184.216.34" ] }

    result = WebDiscovery::PageMetadata.new(transport: transport, resolver: resolver).fetch("https://example.com/article")

    assert_equal "Scientists recovered up to 90% of lithium from used EV batteries.", result[:description]
  end
end
