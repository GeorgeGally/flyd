require "application_system_test_case"

class DirectedSurfaceModesTest < ApplicationSystemTestCase
  setup do
    SurfaceItem.delete_all
    Surface.delete_all
    Rails.cache.clear
  end

  test "investigation exposes uncertainty and opens a focused inquiry" do
    context = Context.create!(name: "Interface research", kind: "temporary")
    scene = Scene.create!(
      scene_key: "investigation:dynamic-interface",
      kind: "investigation",
      status: "active",
      title: "Why does the interface still feel static?",
      context: context
    )
    item = activate_surface(
      scene: scene,
      mode: "investigation",
      kind: "question",
      intent: "investigate",
      renderer: "investigation_scene",
      metadata: {
        "known" => ["The surface already supports semantic scenes."],
        "unknown" => ["Why the experience still defaults to familiar UI patterns."],
        "next_question" => "Which fixed shell is still controlling the experience?"
      },
      actions: [{
        "id" => "investigate",
        "label" => "Investigate",
        "payload" => { "question" => "Which fixed shell is still controlling the experience?" }
      }],
      context_refs: [{ "type" => "context", "id" => context.id }]
    )

    visit root_path

    assert_text "INVESTIGATION"
    assert_text "WHAT WE KNOW"
    assert_text "WHAT IS STILL UNCERTAIN"
    assert_text "Which fixed shell"
    click_on "Investigate"

    conversation = scene.reload.conversation
    assert conversation.present?
    assert_equal context, conversation.context
    assert_selector "form[action='#{conversation_messages_path(conversation)}']"
    assert_match(/Which fixed shell/, conversation.messages.last.content)
    assert_equal "discussed", item.surface_feedbacks.last.signal
  end

  test "action mode stops at confirmation before execution" do
    project = Project.create!(name: "Flyd", root_path: "/tmp/flyd")
    conversation = Conversation.start!(project, summary: "Build the dynamic director")
    scene = Scene.create!(
      scene_key: "build:dynamic-director",
      kind: "build",
      status: "active",
      title: "Build the dynamic interface director",
      project: project,
      conversation: conversation,
      desired_outcome: "Implement mode-specific interface direction."
    )
    activate_surface(
      scene: scene,
      mode: "action",
      kind: "scene",
      intent: "build",
      renderer: "action_scene",
      metadata: {
        "proposed_action" => "Implement mode-specific interface direction.",
        "impact" => "Decision, investigation, and action moments will reshape the whole surface.",
        "readiness" => "ready"
      },
      actions: [{
        "id" => "build",
        "label" => "Review action",
        "payload" => { "instructions" => "Implement mode-specific interface direction." }
      }],
      context_refs: [{ "type" => "project", "id" => project.id }]
    )

    visit root_path

    assert_text "READY TO ACT"
    assert_text "WHAT FLYD WILL DO"
    assert_text "WHAT CHANGES"
    click_on "Review action"

    build = Build.order(:created_at).last
    assert_current_path build_path(build)
    assert_text "OpenCode execution"
    assert_text "Confirm build"
    assert build.proposed?
    assert_nil build.confirmed_at
  end

  private

  def activate_surface(scene:, mode:, kind:, intent:, renderer:, metadata:, actions:, context_refs:)
    surface = Surface.create!(
      status: "draft",
      understanding: "A directed situation.",
      current_intention: "Use the interface required by the moment.",
      focus_item_key: scene.scene_key,
      composition_version: "director-system-test",
      metadata: { "surface_mode" => mode }
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
      summary: scene.summary.presence || "Resolve the situation directly.",
      position: 0,
      context_refs: context_refs,
      actions: actions,
      metadata: metadata
    )
    Surface.activate!(surface)
    item
  end
end
