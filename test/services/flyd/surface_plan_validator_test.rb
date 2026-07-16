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

    assert_match(/exactly one choose action/, error.message)
  end

  test "decision mode requires unique options with one exact action each" do
    duplicate_options = valid_payload
    duplicate_options[:items].first[:metadata][:options].last[:id] = "a"

    error = assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      validate(duplicate_options)
    end
    assert_match(/option ids must be unique/i, error.message)

    duplicate_actions = valid_payload
    duplicate_actions[:items].first[:actions].last[:payload][:option_id] = "a"

    error = assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      validate(duplicate_actions)
    end
    assert_match(/exactly one choose action/i, error.message)

    mismatched_label = valid_payload
    mismatched_label[:items].first[:actions].first[:payload][:option_label] = "A different choice"

    error = assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      validate(mismatched_label)
    end
    assert_match(/must match its displayed option/i, error.message)
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

  test "investigation action must use the exact displayed question" do
    payload = investigation_payload
    payload[:items].first[:actions].first[:payload][:question] = "A different question?"

    error = assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      validate(payload)
    end

    assert_match(/must match the displayed next question/i, error.message)
  end

  test "action readiness controls whether review is executable" do
    ready = action_payload(readiness: "ready", actions: [{
      id: "build",
      label: "Review action",
      payload: { instructions: "Do different work." }
    }])

    error = assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      validate(ready)
    end
    assert_match(/must match the displayed proposed work/i, error.message)

    blocked = action_payload(readiness: "blocked", actions: [])
    result = validate(blocked)
    assert_equal "blocked", result["items"].first.dig("metadata", "readiness")

    running = action_payload(readiness: "running", actions: [{
      id: "build",
      label: "Review action",
      payload: { instructions: "Perform the proposed work." }
    }])
    error = assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      validate(running)
    end
    assert_match(/must not offer a build action/i, error.message)
  end

  test "renderer action contracts also apply to supporting items" do
    payload = valid_payload
    support = investigation_payload[:items].first
    support[:id] = "supporting-investigation"
    support[:actions].first[:payload][:question] = "A different question?"
    payload[:items] << support

    error = assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      validate(payload)
    end

    assert_match(/must match the displayed next question/i, error.message)
  end

  test "monitoring mode requires a focused notification" do
    payload = valid_payload
    payload[:surface_mode] = "monitoring"
    payload[:items].first.merge!(
      kind: "notification",
      intent: "monitor",
      renderer: "notification",
      actions: [],
      metadata: {}
    )

    result = Flyd::SurfacePlanValidator.call(payload: payload, reference_registry: [ "project:1", "goal:goal:ship" ])
    assert_equal "monitoring", result["surface_mode"]

    payload[:items].first[:renderer] = "hero_scene"
    error = assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      Flyd::SurfacePlanValidator.call(payload: payload, reference_registry: [ "project:1", "goal:goal:ship" ])
    end
    assert_match(/must focus a notification/, error.message)
  end

  test "discovery accepts up to three grounded discovery scenes" do
    payload = valid_payload
    payload[:surface_mode] = "discovery"
    payload[:items].first.merge!(
      kind: "insight",
      intent: "inform",
      renderer: "discovery_scene",
      actions: [ { id: "inspect_sources", label: "Open source", payload: {} } ],
      metadata: {
        why_it_matters: "This connects directly to Flyd's interface model.",
        source_label: "From your archive",
        provenance: "Published 14 Jul 2026"
      }
    )

    result = Flyd::SurfacePlanValidator.call(payload: payload, reference_registry: [ "project:1", "goal:goal:ship" ])

    assert_equal "discovery", result["surface_mode"]
    assert_equal "From your archive", result["items"].first.dig("metadata", "source_label")
    assert_equal "Published 14 Jul 2026", result["items"].first.dig("metadata", "provenance")

    payload[:items] = [ payload[:items].first, payload[:items].first.deep_dup.merge(id: "second"), payload[:items].first.deep_dup.merge(id: "third") ]
    result = Flyd::SurfacePlanValidator.call(payload: payload, reference_registry: [ "project:1", "goal:goal:ship" ])
    assert_equal 3, result["items"].length

    payload[:items] << payload[:items].first.deep_dup.merge(id: "fourth")
    error = assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      Flyd::SurfacePlanValidator.call(payload: payload, reference_registry: [ "project:1", "goal:goal:ship" ])
    end
    assert_match(/supports at most 3 items/, error.message)

    payload[:items] = [ payload[:items].first ]
    payload[:items].first[:source_refs] = []
    error = assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      Flyd::SurfacePlanValidator.call(payload: payload, reference_registry: [ "project:1", "goal:goal:ship" ])
    end
    assert_match(/requires grounded source evidence/, error.message)
  end

  test "media metadata must bind to an explicit retained attachment source" do
    payload = valid_payload
    payload[:surface_mode] = "monitoring"
    item = payload[:items].first.dup
    payload[:focus_item_id] = "monitor:attachment"
    payload[:items] = [
      {
        id: "monitor:attachment",
        kind: "notification",
        intent: "monitor",
        title: "New attachment evidence",
        summary: "An image is ready for inspection.",
        renderer: "notification",
        depth: "foreground",
        context_refs: [{ type: "project", id: 1 }],
        source_refs: [{ type: "goal", id: "goal:ship" }],
        metadata: {},
        actions: []
      },
      item
    ]
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
    assert_equal 99, result["items"].second.dig("metadata", "attachment_id")
  end

  test "decision option media must bind to explicit attachment sources" do
    payload = valid_payload
    payload[:items].first[:metadata][:options].first[:attachment_id] = 91

    error = assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      Flyd::SurfacePlanValidator.call(
        payload: payload,
        reference_registry: [ "project:1", "goal:goal:ship", "intent_attachment:91" ]
      )
    end

    assert_match(/Decision option media must be an explicit source reference/, error.message)

    payload[:items].first[:source_refs] << { type: "intent_attachment", id: 91 }
    result = Flyd::SurfacePlanValidator.call(
      payload: payload,
      reference_registry: [ "project:1", "goal:goal:ship", "intent_attachment:91" ]
    )

    assert_equal 91, result["items"].first.dig("metadata", "options", 0, "attachment_id")
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

  def validate(payload)
    Flyd::SurfacePlanValidator.call(
      payload: payload,
      reference_registry: [ "project:1", "goal:goal:ship" ]
    )
  end

  def investigation_payload
    payload = valid_payload
    payload[:surface_mode] = "investigation"
    payload[:items].first.merge!(
      kind: "question",
      intent: "investigate",
      renderer: "investigation_scene",
      metadata: { known: ["The symptom is repeatable"], unknown: ["The cause"], next_question: "What changed?" },
      actions: [{ id: "investigate", label: "Investigate", payload: { question: "What changed?" } }]
    )
    payload
  end

  def action_payload(readiness:, actions:)
    payload = valid_payload
    payload[:surface_mode] = "action"
    payload[:items].first.merge!(
      kind: "scene",
      intent: "build",
      renderer: "action_scene",
      metadata: {
        proposed_action: "Perform the proposed work.",
        impact: "The surface contract becomes reliable.",
        readiness: readiness
      },
      actions: actions
    )
    payload
  end

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
