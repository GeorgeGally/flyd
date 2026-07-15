require "test_helper"

class Flyd::WorldStateCompilerTest < ActiveSupport::TestCase
  FakeProvider = Struct.new(:payload) do
    def snapshot = payload
  end

  test "bounds, deduplicates, and registers only retained evidence" do
    provider = FakeProvider.new({
      providers: [{
        source: "test",
        snapshot_id: 7,
        state_digest: "provider-digest",
        fresh: true,
        errors: [],
        data: {
          goals: [ evidence("goal:ship"), evidence("goal:ship") ],
          reports: Array.new(20) { |index| evidence("report:#{index}", type: "report", body: "x" * 2_000) }
        }
      }]
    })

    result = Flyd::WorldStateCompiler.call(state_provider: provider, budget: 2_500)
    goals = result.state.dig(:provider_state, :providers, 0, :data, :goals)
    retained_refs = result.state.dig(:provider_state, :providers).flat_map do |entry|
      entry[:data].values.flatten.map { |item| "#{item[:type]}:#{item[:id]}" }
    end

    assert_equal 1, goals.length
    assert_includes result.reference_registry, "goal:goal:ship"
    assert_equal retained_refs.sort, result.reference_registry.grep(/^(goal|report):/).sort
    assert_operator JSON.generate(result.state).length, :<=, 2_500
    assert result.diagnostics[:dropped].any?
  end

  test "includes active intent corrections and recent feedback" do
    surface = Surface.fallback!
    intent = Intent.create!(input_text: "What should happen next?", origin_surface: surface)
    ContextCorrection.create!(intent: intent, original_contexts: [], corrected_contexts: [], reason: "Global thought")
    SurfaceFeedback.create!(surface: surface, surface_item: surface.items.first, signal: "useful")

    result = Flyd::WorldStateCompiler.call(
      active_intent: intent,
      state_provider: FakeProvider.new({ providers: [] })
    )

    assert_equal intent.id, result.state.dig(:active_intent, :id)
    assert_equal "Global thought", result.state[:context_corrections].first[:reason]
    assert_equal "useful", result.state[:recent_feedback].first[:signal]
  end

  test "budgeting retains representative evidence from every provider collection" do
    provider = FakeProvider.new({
      providers: [
        {
          source: "flyd-cli", fresh: true, data: {
            reports: Array.new(8) { |index| evidence("report:#{index}", type: "report", body: "archive " * 300) }
          }
        },
        {
          source: "personal-context", fresh: true, data: {
            activities: Array.new(8) { |index| evidence("activity:#{index}", type: "activity", body: "activity " * 300) },
            horoscopes: [ evidence("horoscope:today", type: "horoscope", body: "horoscope " * 300) ]
          }
        },
        {
          source: "web-discovery", fresh: true, data: {
            discoveries: Array.new(8) { |index| evidence("discovery:#{index}", type: "discovery", body: "discovery " * 300) }
          }
        }
      ]
    })

    result = Flyd::WorldStateCompiler.call(state_provider: provider, budget: 3_500)
    providers = result.state.dig(:provider_state, :providers).index_by { |entry| entry[:source] }

    assert providers.dig("flyd-cli", :data, :reports).any?
    assert providers.dig("personal-context", :data, :activities).any?
    assert providers.dig("personal-context", :data, :horoscopes).any?
    assert_operator providers.dig("web-discovery", :data, :discoveries).length, :>=, 3
    assert_operator JSON.generate(result.state).length, :<=, 3_500
  end

  private

  def evidence(id, type: "goal", body: "ship")
    {
      id: id,
      type: type,
      source: "test",
      epistemicStatus: "observation",
      confidence: 0.8,
      generatedAt: Time.current.iso8601,
      evidenceRefs: [],
      content: { body: body }
    }
  end
end
