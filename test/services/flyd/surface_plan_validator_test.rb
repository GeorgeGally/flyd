require "test_helper"

class Flyd::SurfacePlanValidatorTest < ActiveSupport::TestCase
  test "accepts semantic ids while requiring source references to exist" do
    result = Flyd::SurfacePlanValidator.call(
      payload: valid_payload,
      reference_registry: [ "project:1", "goal:goal:ship" ]
    )

    assert_equal "new-scene-id", result["items"].first["id"]
    assert_equal "goal:ship", result["items"].first["source_refs"].first["id"]
    assert_equal "decision_scene", result["items"].first["renderer"]
  end

  test "rejects hallucinated references" do
    payload = valid_payload
    payload[:items].first[:source_refs] = [{ type: "goal", id: "goal:missing" }]

    error = assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      Flyd::SurfacePlanValidator.call(payload: payload, reference_registry: [ "project:1" ])
    end

    assert_match(/Unknown reference/, error.message)
  end

  test "rejects unsupported actions and renderers" do
    payload = valid_payload
    payload[:items].first[:renderer] = "image"
    payload[:items].first[:actions] = [{ id: "teleport", label: "Teleport" }]

    error = assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      Flyd::SurfacePlanValidator.call(payload: payload, reference_registry: [ "project:1", "goal:goal:ship" ])
    end

    assert_match(/Unsupported renderer/, error.message)
    assert_match(/Unsupported action/, error.message)
  end

  test "rejects a mode that the current situation does not justify" do
    error = assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      Flyd::SurfacePlanValidator.call(
        payload: valid_payload,
        reference_registry: [ "project:1", "goal:goal:ship" ],
        allowed_modes: [ "quiet", "conversation" ]
      )
    end

    assert_match(/not justified by the current situation/, error.message)
  end

  test "decision mode requires a decision interface with real choices" do
    payload = valid_payload
    payload[:items].first[:actions] = [{ id: "discuss", label: "Discuss" }]

    error = assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      Flyd::SurfacePlanValidator.call(payload: payload, reference_registry: [ "project:1", "goal:goal:ship" ])
    end

    assert_match(/requires choose actions/, error.message)
  end

  test "investigation mode requires known uncertainty and a next question" do
    payload = valid_payload
    payload[:surface_mode] = "investigation"
    payload[:items].first.merge!(
      kind: "question",
      intent: "investigate",
      renderer: "investigation_scene",
      metadata: { known: ["The symptom is repeatable"], unknown: ["The cause"], next_question: "What changed?" },
      actions: [{ id: "investigate", label: "Investigate", payload: { question: "What changed?" } }]
    )

    result = Flyd::SurfacePlanValidator.call(payload: payload, reference_registry: [ "project:1", "goal:goal:ship" ])
    assert_equal "investigation", result["surface_mode"]
    assert_equal "What changed?", result["items"].first.dig("metadata", "next_question")
  end

  test "media metadata must bind to an explicit retained attachment source" do
    payload = valid_payload
    payload[:surface_mode] = "monitoring"
    item = payload[:items].first
    item[:kind] = "artifact"
    item[:intent] = "monitor"
    item[:renderer] = "media"
    item[:metadata] = { media_type: "image", attachment_id: 99 }
    item[:actions] = []

    error = assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      Flyd::SurfacePlanValidator.call(
        payload: payload,
        reference_registry: [ "project:1", "goal:goal:ship", "intent_attachment:99" ]
      )
    end

    assert_match(/explicit source reference/, error.message)

    item[:source_refs] << { type: "intent_attachment", id: 99 }
    result = Flyd::SurfacePlanValidator.call(
      payload: payload,
      reference_registry: [ "project:1", "goal:goal:ship", "intent_attachment:99" ]
    )
    assert_equal 99, result["items"].first.dig("metadata", "attachment_id")
  end

  test "context-correction payloads may reference only compiled contexts" do
    payload = valid_payload
    payload[:items].first[:actions] << {
      id: "correct_context",
      label: "Correct",
      payload: { contexts: [{ type: "project", id: 999 }] }
    }

    error = assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      Flyd::SurfacePlanValidator.call(payload: payload, reference_registry: [ "project:1", "goal:goal:ship" ])
    end

    assert_match(/Unknown correction context/, error.message)
  end

  private

  def valid_payload
    {
      understanding: "The architecture needs one decision.",
      current_intention: "Help resolve it.",
      surface_mode: "decision",
      focus_item_id: "new-scene-id",
      items: [{
        id: "new-scene-id",
        kind: "decision",
        intent: "decide",
        title: "Resolve the architecture",
        summary: "Choose the next implementation boundary.",
        renderer: "decision_scene",
        depth: "foreground",
        context_refs: [{ type: "project", id: 1 }],
        source_refs: [{ type: "goal", id: "goal:ship" }],
        metadata: {
          options: [
            { id: "a", label: "Build the director", description: "Make the interface situational." },
            { id: "b", label: "Keep the current shell", description: "Continue with conversation-first UI." }
          ],
          recommendation: "Build the director."
        },
        actions: [
          { id: "choose", label: "Choose director", payload: { option_id: "a", option_label: "Build the director" } },
          { id: "choose", label: "Choose shell", payload: { option_id: "b", option_label: "Keep the current shell" } }
        ]
      }],
      relationships: []
    }
  end
end
