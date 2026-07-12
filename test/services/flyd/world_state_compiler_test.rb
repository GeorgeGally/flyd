require "test_helper"

class Flyd::WorldStateCompilerTest < ActiveSupport::TestCase
  FakeProvider = Struct.new(:payload) do
    def snapshot = payload
  end

  test "bounds, deduplicates, and registers evidence references" do
    provider = FakeProvider.new(
      providers: [{
        source: "test",
        fresh: true,
        errors: [],
        data: {
          goals: [evidence("goal:ship"), evidence("goal:ship")],
          reports: Array.new(20) { |index| evidence("report:#{index}", type: "report", body: "x" * 2_000) }
        }
      }]
    )

    result = Flyd::WorldStateCompiler.call(state_provider: provider, budget: 5_000)
    goals = result.state.dig(:provider_state, :providers, 0, :data, :goals)

    assert_equal 1, goals.length
    assert_includes result.reference_registry, "goal:goal:ship"
    assert_operator JSON.generate(result.state).length, :<=, 5_500
    assert result.diagnostics[:dropped].any?
  end

  test "includes active intent corrections and recent feedback" do
    surface = Surface.fallback!
    intent = Intent.create!(input_text: "What should happen next?", origin_surface: surface)
    ContextCorrection.create!(intent: intent, original_contexts: [], corrected_contexts: [], reason: "Global thought")
    SurfaceFeedback.create!(surface: surface, surface_item: surface.items.first, signal: "useful")

    result = Flyd::WorldStateCompiler.call(
      active_intent: intent,
      state_provider: FakeProvider.new(providers: [])
    )

    assert_equal intent.id, result.state.dig(:active_intent, :id)
    assert_equal "Global thought", result.state[:context_corrections].first[:reason]
    assert_equal "useful", result.state[:recent_feedback].first[:signal]
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
