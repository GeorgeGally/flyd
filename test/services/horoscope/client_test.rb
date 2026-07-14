require "test_helper"

class Horoscope::ClientTest < ActiveSupport::TestCase
  test "extracts the current configured sign from the fixed source" do
    transport = lambda do |uri, **|
      assert_equal "https://www.astrology.com/horoscope/daily/aries.html", uri.to_s
      <<~HTML
        <html><body>
          <h1 id="content-title">Aries Daily Horoscope</h1>
          <p class="byline">By <a>Renee Watt</a></p>
          <div class="horoscope-content-wrapper">
            <span id="content-date">July 14, 2026</span>
            <div id="content"><p>Take the creative risk that has been waiting for your attention.</p></div>
          </div>
        </body></html>
      HTML
    end

    result = Horoscope::Client.new(sign: "aries", transport:).fetch

    assert_equal "Aries", result[:sign]
    assert_equal Date.new(2026, 7, 14), result[:date]
    assert_equal "Take the creative risk that has been waiting for your attention.", result[:description]
    assert_equal "Renee Watt", result[:author]
  end

  test "rejects an unsupported sign" do
    assert_raises(ArgumentError) { Horoscope::Client.new(sign: "ophiuchus") }
  end
end
