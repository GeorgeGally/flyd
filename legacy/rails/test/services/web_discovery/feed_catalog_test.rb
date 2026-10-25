require "test_helper"

class WebDiscovery::FeedCatalogTest < ActiveSupport::TestCase
  test "contains every configured publisher feed" do
    sources = WebDiscovery::FeedCatalog.sources
    urls = sources.pluck(:url)

    assert_includes urls, "https://daringfireball.net/feeds/main"
    assert_includes urls, "https://feeds.arstechnica.com/arstechnica/index"
    assert_includes urls, "https://hackaday.com/blog/feed/"
    assert_includes urls, "https://techcrunch.com/feed/"
    assert_includes urls, "https://www.techradar.com/feeds.xml"
    assert_includes urls, "https://feeds2.feedburner.com/TheNextWeb"
    assert_includes urls, "https://www.fastcompany.com/latest/rss?truncated=false"
    assert_includes urls, "https://rss.slashdot.org/Slashdot/slashdot"
    assert_includes urls, "https://www.smashingmagazine.com/feed/"
    assert_includes urls, "https://feeds.feedburner.com/InformationIsBeautiful"
    assert_includes urls, "https://feeds.feedburner.com/uncrate"
    assert_includes urls, "https://feeds.feedburner.com/core77/blog"
    assert_includes urls, "https://flowingdata.com/feed"
    assert_includes urls, "https://feeds.feedburner.com/design-milk"
    assert_equal urls.uniq, urls
  end

  test "expands every configured subreddit into a direct Atom feed" do
    reddit = WebDiscovery::FeedCatalog.sources.select { |source| source[:kind] == "reddit" }

    assert_equal 25, reddit.length
    assert_includes reddit.pluck(:url), "https://www.reddit.com/r/creativecoding/.rss"
    assert_includes reddit.pluck(:url), "https://www.reddit.com/r/StableDiffusion/.rss"
    assert_includes reddit.pluck(:url), "https://www.reddit.com/r/Bitcoin/.rss"
    assert_includes reddit.pluck(:url), "https://www.reddit.com/r/AskHistorians/.rss"
    assert reddit.all? { |source| source[:category].present? }
  end
end
