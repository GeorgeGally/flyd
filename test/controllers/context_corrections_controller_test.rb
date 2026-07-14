require "test_helper"

class ContextCorrectionsControllerTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  test "accepts no persistent context without creating an Inbox project" do
    intent = Intent.create!(input_text: "A global thought", status: "clarification_required")

    assert_difference("ContextCorrection.count", 1) do
      post intent_context_corrections_path(intent), params: { reason: "No persistent context" }
    end

    assert_redirected_to root_path(intent_id: intent.id)
    assert_equal "accepted", intent.reload.status
    assert_empty intent.resolved_contexts
    assert_not Project.exists?(name: "Inbox")
  end

  test "corrected project context supersedes the incorrectly routed conversation" do
    wrong_project = Project.create!(name: "Wrong")
    correct_project = Project.create!(name: "Flyd")
    old_conversation = Conversation.start!(wrong_project)
    old_conversation.messages.create!(role: "user", content: "Fix this")
    intent = Intent.create!(input_text: "Fix this", status: "accepted", conversation: old_conversation)

    post intent_context_corrections_path(intent), params: {
      corrected_contexts: [{ type: "project", id: correct_project.id, name: correct_project.name }]
    }

    intent.reload
    assert_equal correct_project, intent.conversation.project
    assert_equal "Fix this", intent.conversation.messages.last.content
    assert_equal "superseded", old_conversation.reload.status
    assert_equal intent.conversation, old_conversation.superseded_by_conversation
    assert_equal correct_project.id.to_s, intent.resolved_contexts.first["id"].to_s
  end

  test "corrected temporary context starts a non-project conversation" do
    context = Context.create!(name: "Interface sprint")
    intent = Intent.create!(input_text: "Continue this", status: "clarification_required")

    post intent_context_corrections_path(intent), params: {
      corrected_contexts: [{ type: "context", id: context.id, name: context.name }]
    }

    assert_equal context, intent.reload.conversation.context
    assert_nil intent.conversation.project
  end

  test "rejects fabricated context references" do
    intent = Intent.create!(input_text: "Fix this", status: "clarification_required")

    assert_no_difference("ContextCorrection.count") do
      post intent_context_corrections_path(intent), params: {
        corrected_contexts: [{ type: "project", id: 999_999, name: "Imaginary" }]
      }
    end

    assert_redirected_to root_path(intent_id: intent.id)
    assert_equal "clarification_required", intent.reload.status
  end

  test "surface correction uses the scene intent instead of a stale source reference" do
    wrong_intent = Intent.create!(input_text: "Wrong thought", status: "clarification_required")
    correct_intent = Intent.create!(input_text: "Move this thought", status: "clarification_required")
    project = Project.create!(name: "Flyd")
    scene = Scene.create!(
      scene_key: "context:move-thought",
      kind: "work",
      status: "active",
      title: "Move this thought",
      intent: correct_intent
    )
    surface = Surface.create!(
      status: "draft",
      understanding: "The context needs correction.",
      current_intention: "Put the thought in the right place.",
      focus_item_key: scene.scene_key,
      composition_version: "test"
    )
    item = surface.items.create!(
      scene: scene,
      item_key: scene.scene_key,
      kind: "scene",
      intent: "inform",
      renderer: "hero_scene",
      depth: "foreground",
      state: "presented",
      title: scene.title,
      position: 0,
      source_refs: [{ "type" => "intent", "id" => wrong_intent.id }],
      actions: [{ "id" => "correct_context", "label" => "Correct context", "payload" => {} }]
    )

    post surface_item_context_corrections_path(item), params: {
      corrected_contexts: [{ type: "project", id: project.id, name: project.name }]
    }

    assert_equal "accepted", correct_intent.reload.status
    assert_equal project, correct_intent.conversation.project
    assert_equal "clarification_required", wrong_intent.reload.status
  end

  test "rejects context correction that the surface item did not offer" do
    intent = Intent.create!(input_text: "Keep this here", status: "clarification_required")
    scene = Scene.create!(scene_key: "context:locked", kind: "work", status: "active", title: "Keep this here", intent: intent)
    surface = Surface.create!(status: "draft", understanding: "Stable context.", current_intention: "Keep it stable.", composition_version: "test")
    item = surface.items.create!(
      scene: scene,
      item_key: scene.scene_key,
      kind: "scene",
      intent: "inform",
      renderer: "hero_scene",
      depth: "foreground",
      state: "presented",
      title: scene.title,
      position: 0,
      actions: []
    )

    assert_no_difference("ContextCorrection.count") do
      post surface_item_context_corrections_path(item), params: { reason: "No change" }
    end

    assert_redirected_to root_path
    assert_equal "clarification_required", intent.reload.status
  end
end
