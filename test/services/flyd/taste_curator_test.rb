require "test_helper"

class Flyd::TasteCuratorTest < ActiveSupport::TestCase
  FakeChat = Struct.new(:response, :received_messages) do
    def call!(messages)
      self.received_messages = messages
      response
    end
  end

  test "comparatively curates stories and forces one rabbit hole" do
    chat = FakeChat.new(JSON.generate(
      judgments: [
        { key: "hn:1", verdict: "hot", reason: "A strange constrained hardware experiment." },
        { key: "feed:2", verdict: "worth_a_look", reason: "A deep visual explanation with an unusual premise." },
        { key: "feed:3", verdict: "skip", reason: "Incremental consumer product coverage." }
      ],
      rabbit_hole_key: "feed:2"
    ))

    selected = Flyd::TasteCurator.new(stories:, context:, chat:, limit: 8).call

    assert_equal [ 2, 1 ], selected.pluck(:id)
    assert_equal true, selected.first[:rabbit_hole]
    assert_equal "worth_a_look", selected.first[:interest_verdict]
    assert_equal "A deep visual explanation with an unusual premise.", selected.first[:interest_reason]
    assert_equal false, selected.second[:rabbit_hole]
    assert_includes chat.received_messages.first[:content], "Weird over practical"
    assert_includes chat.received_messages.first[:content], "not a conventional news headline"
    sent = JSON.parse(chat.received_messages.last[:content])
    assert_includes sent.dig("personal_context", "goals"), "Build personal intelligence"
    assert_includes sent.dig("personal_context", "recent_work"), "Continue Flyd"
    assert_equal %w[hn:1 feed:2 feed:3], sent.fetch("candidates").pluck("key")
  end

  test "rejects unknown duplicate incomplete and malformed judgments" do
    responses = [
      {
        judgments: [
          { key: "hn:1", verdict: "skip", reason: "Skip." },
          { key: "feed:2", verdict: "skip", reason: "Skip." },
          { key: "unknown:9", verdict: "hot", reason: "Unknown." }
        ],
        rabbit_hole_key: "unknown:9"
      }.to_json,
      {
        judgments: [
          { key: "hn:1", verdict: "hot", reason: "First." },
          { key: "hn:1", verdict: "skip", reason: "Duplicate." },
          { key: "feed:2", verdict: "skip", reason: "Skip." },
          { key: "feed:3", verdict: "skip", reason: "Skip." }
        ],
        rabbit_hole_key: "hn:1"
      }.to_json,
      {
        judgments: [
          { key: "hn:1", verdict: "hot", reason: "" },
          { key: "feed:2", verdict: "skip", reason: "Skip." },
          { key: "feed:3", verdict: "skip", reason: "Skip." }
        ],
        rabbit_hole_key: "hn:1"
      }.to_json,
      {
        judgments: [
          { key: "hn:1", verdict: "maybe", reason: "Evasive." },
          { key: "feed:2", verdict: "skip", reason: "Skip." },
          { key: "feed:3", verdict: "skip", reason: "Skip." }
        ],
        rabbit_hole_key: "hn:1"
      }.to_json,
      "not json"
    ]

    responses.each do |response|
      assert_raises(Flyd::TasteCurator::ValidationError) do
        Flyd::TasteCurator.new(stories:, context:, chat: FakeChat.new(response)).call
      end
    end
  end

  test "accepts an opinionated all-skip judgment without inventing a rabbit hole" do
    response = {
      judgments: [
        { key: "hn:1", verdict: "skip", reason: "Routine." },
        { key: "feed:2", verdict: "skip", reason: "Generic." },
        { key: "feed:3", verdict: "skip", reason: "Incremental." }
      ],
      rabbit_hole_key: nil
    }.to_json

    assert_empty Flyd::TasteCurator.new(stories:, context:, chat: FakeChat.new(response)).call
  end

  test "requires every candidate to be judged and an accepted rabbit hole" do
    missing_judgment = {
      judgments: [
        { key: "hn:1", verdict: "hot", reason: "Interesting." },
        { key: "feed:2", verdict: "skip", reason: "Skip." }
      ],
      rabbit_hole_key: "hn:1"
    }.to_json
    missing_rabbit = {
      judgments: [
        { key: "hn:1", verdict: "hot", reason: "Interesting." },
        { key: "feed:2", verdict: "skip", reason: "Skip." },
        { key: "feed:3", verdict: "skip", reason: "Skip." }
      ],
      rabbit_hole_key: nil
    }.to_json

    [ missing_judgment, missing_rabbit ].each do |response|
      assert_raises(Flyd::TasteCurator::ValidationError) do
        Flyd::TasteCurator.new(stories:, context:, chat: FakeChat.new(response)).call
      end
    end
  end

  private

  def stories
    [
      story(1, "hn", "A pocket-sized computer built under severe constraints"),
      story(2, "feed", "An obscure visual history of forgotten protocols"),
      story(3, "feed", "A slightly faster consumer phone")
    ]
  end

  def story(id, source_key, title)
    {
      id:, source_key:, title:, url: "https://example.com/#{id}",
      description: "A sufficiently detailed description for story #{id}.",
      source_name: source_key.titleize, source_category: "technology",
      published_at: 1.hour.ago, score: 10
    }
  end

  def context
    {
      cli: {
        goals: [ { "content" => { "title" => "Build personal intelligence" } } ],
        signals: [ { "content" => { "topic" => "creative coding" } } ],
        reports: [ { "content" => { "title" => "Internet archaeology" } } ]
      },
      personal: {
        activities: [ { "content" => { "title" => "Continue Flyd" } } ]
      }
    }
  end
end
