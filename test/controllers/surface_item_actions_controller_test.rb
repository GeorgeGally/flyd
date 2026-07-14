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
    item = activate_item(
      scene: scene,
      kind: "decision",
      intent: "decide",
      renderer: "decision_scene",
      actions: [{ "id" => "choose", "label" => "Choose", "payload" => {} }]
    )

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
    item = activate_item(
      scene: scene,
      kind: "question",
      intent: "investigate",
      renderer: "investigation_scene",
      context: context,
      actions: [{ "id" => "investigate", "label" => "Investigate", "payload" => {} }]
    )

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

  test "rejects a supported action that the item did not offer" do
    context = Context.create!(name: "Restricted action", kind: "temporary")
    scene = Scene.create!(scene_key: "restricted:action", kind: "work", status: "active", title: "Restricted action", context: context)
    item = activate_item(scene: scene, kind: "scene", intent: "inform", renderer: "hero_scene", context: context, actions: [])

    assert_no_difference(["Conversation.count", "SurfaceFeedback.count"]) do
      post surface_item_action_path(item, action_id: "discuss")
    end

    assert_redirected_to root_path
    assert_equal "Action is not available for this item.", flash[:alert]
  end

  test "discuss and answer actions open the item conversation" do
    context = Context.create!(name: "Open question", kind: "temporary")
    scene = Scene.create!(scene_key: "question:discuss", kind: "question", status: "active", title: "Open question", context: context)
    item = activate_item(
      scene: scene,
      kind: "question",
      intent: "discuss",
      renderer: "hero_scene",
      context: context,
      actions: [
        { "id" => "discuss", "label" => "Discuss", "payload" => {} },
        { "id" => "answer", "label" => "Answer", "payload" => {} }
      ]
    )

    assert_difference("Conversation.count", 1) do
      post surface_item_action_path(item, action_id: "discuss")
    end

    conversation = scene.reload.conversation
    assert_redirected_to root_path(conversation_id: conversation.id)

    assert_no_difference("Conversation.count") do
      post surface_item_action_path(item, action_id: "answer")
    end
    assert_redirected_to root_path(conversation_id: conversation.id)
    assert_equal 2, item.surface_feedbacks.where(signal: "discussed").count
  end

  test "build action explains that a project-owned scene is required" do
    context = Context.create!(name: "Temporary work", kind: "temporary")
    conversation = Conversation.start!(context)
    scene = Scene.create!(
      scene_key: "build:temporary",
      kind: "build",
      status: "active",
      title: "Temporary work",
      context: context,
      conversation: conversation
    )
    item = activate_item(
      scene: scene,
      kind: "scene",
      intent: "build",
      renderer: "action_scene",
      context: context,
      actions: [{ "id" => "build", "label" => "Build", "payload" => {} }]
    )

    assert_no_difference("Build.count") do
      post surface_item_action_path(item, action_id: "build")
    end

    assert_redirected_to root_path
    assert_equal "Build currently requires a project-owned scene", flash[:alert]
  end

  private

  def activate_item(scene:, kind:, intent:, renderer:, context: nil, actions: [])
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
      context_refs: context ? [{ "type" => "context", "id" => context.id }] : [],
      actions: actions
    )
    Surface.activate!(surface)
    item
  end
end
