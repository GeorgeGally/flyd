require "test_helper"

class SurfaceItemActionsControllerTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  test "choosing a decision creates durable work and resolves the scene" do
    project = Project.create!(name: "Flyd")
    conversation = Conversation.start!(project, summary: "Choose the interface")
    scene = Scene.create!(
      scene_key: "decision:interface",
      kind: "decision",
      status: "active",
      title: "Choose the interface",
      project: project,
      conversation: conversation
    )
    item = activate_item(scene: scene, kind: "decision", intent: "decide", renderer: "decision_scene")

    assert_difference(["Artifact.count", "Decision.count"], 1) do
      post surface_item_action_path(item, action_id: "choose"), params: {
        payload: { option_id: "director", option_label: "Dynamic director" }
      }
    end

    assert_redirected_to root_path
    assert_equal "resolved", scene.reload.status
    assert_equal "Dynamic director", scene.resolution_summary
    assert_equal "collapsed", item.reload.state
    assert_equal "Dynamic director", Artifact.last.content
  end

  test "investigating starts a focused inquiry instead of restoring passive chat" do
    context = Context.create!(name: "Interface question", kind: "temporary")
    scene = Scene.create!(
      scene_key: "investigation:interface",
      kind: "investigation",
      status: "active",
      title: "Why is the interface static?",
      context: context
    )
    item = activate_item(scene: scene, kind: "question", intent: "investigate", renderer: "investigation_scene", context: context)

    assert_enqueued_with(job: LlmStreamingJob) do
      post surface_item_action_path(item, action_id: "investigate"), params: {
        payload: { question: "What prevents the interface from changing around the situation?" }
      }
    end

    conversation = scene.reload.conversation
    assert_redirected_to root_path(conversation_id: conversation.id)
    assert_equal context, conversation.context
    assert_match(/Investigate this question/, conversation.messages.last.content)
    assert_match(/What prevents/, conversation.messages.last.content)
  end

  private

  def activate_item(scene:, kind:, intent:, renderer:, context: nil)
    surface = Surface.create!(
      status: "draft",
      understanding: "A directed situation.",
      current_intention: "Resolve it.",
      focus_item_key: scene.scene_key,
      composition_version: "director-test",
      metadata: { "surface_mode" => renderer.sub("_scene", "") }
    )
    item = surface.items.create!(
      scene: scene,
      item_key: scene.scene_key,
      kind: kind,
      intent: intent,
      renderer: renderer,
      depth: "foreground",
      state: "presented",
      title: scene.title,
      summary: "A directed surface item.",
      position: 0,
      context_refs: context ? [{ "type" => "context", "id" => context.id }] : []
    )
    Surface.activate!(surface)
    item
  end
end
