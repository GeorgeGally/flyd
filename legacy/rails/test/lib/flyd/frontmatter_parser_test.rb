require "test_helper"

class Flyd::FrontmatterParserTest < ActiveSupport::TestCase
  test "parses empty content as empty metadata" do
    result = Flyd::FrontmatterParser.parse("just a body")
    assert_equal({}, result.metadata)
    assert_equal "just a body", result.body
  end

  test "parses simple key-value pairs" do
    content = "---\nsource: cli\nproject: flyd\n---\n\nbody text"
    result = Flyd::FrontmatterParser.parse(content)
    assert_equal "cli", result.metadata["source"]
    assert_equal "flyd", result.metadata["project"]
    assert_equal "body text", result.body
  end

  test "coerces numbers" do
    content = "---\ncount: 42\nscore: 3.14\n---\n\nbody"
    result = Flyd::FrontmatterParser.parse(content)
    assert_equal 42, result.metadata["count"]
    assert_equal 3.14, result.metadata["score"]
  end

  test "coerces booleans" do
    content = "---\nactive: true\narchived: false\n---\n\nbody"
    result = Flyd::FrontmatterParser.parse(content)
    assert_equal true, result.metadata["active"]
    assert_equal false, result.metadata["archived"]
  end

  test "parses string lists" do
    content = "---\ntags:\n  - ruby\n  - rails\n  - hotwire\n---\n\nbody"
    result = Flyd::FrontmatterParser.parse(content)
    assert_equal [ "ruby", "rails", "hotwire" ], result.metadata["tags"]
  end

  test "parses object lists" do
    content = "---\nitems:\n  - name: foo\n    count: 1\n  - name: bar\n    count: 2\n---\n\nbody"
    result = Flyd::FrontmatterParser.parse(content)
    assert_equal 2, result.metadata["items"].length
    assert_equal "foo", result.metadata["items"][0]["name"]
    assert_equal 1, result.metadata["items"][0]["count"]
    assert_equal "bar", result.metadata["items"][1]["name"]
    assert_equal 2, result.metadata["items"][1]["count"]
  end

  test "handles timestamp format" do
    content = "---\ntimestamp: 2026-07-07 10:00:00\n---\n\nbody"
    result = Flyd::FrontmatterParser.parse(content)
    assert_equal "2026-07-07 10:00:00", result.metadata["timestamp"]
  end

  test "handles session_id" do
    content = "---\nsession_id: abc-123-def\n---\n\nbody"
    result = Flyd::FrontmatterParser.parse(content)
    assert_equal "abc-123-def", result.metadata["session_id"]
  end

  test "returns empty metadata for content without frontmatter" do
    content = "regular\ntext\nwithout\nfrontmatter"
    result = Flyd::FrontmatterParser.parse(content)
    assert_equal({}, result.metadata)
    assert_equal content, result.body
  end

  test "handles empty frontmatter" do
    content = "---\n---\n\nbody"
    result = Flyd::FrontmatterParser.parse(content)
    assert_equal({}, result.metadata)
    assert_equal "body", result.body
  end

  test "key with empty value starts list mode" do
    content = "---\nitems:\n  - one\n  - two\n---\n\nbody"
    result = Flyd::FrontmatterParser.parse(content)
    assert_equal [ "one", "two" ], result.metadata["items"]
  end
end
