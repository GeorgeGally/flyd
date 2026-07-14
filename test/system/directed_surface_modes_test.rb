require "application_system_test_case"

class DirectedSurfaceModesTest < ApplicationSystemTestCase
  setup do
    Surface.delete_all
    Rails.cache.clear
  end

  test "investigation exposes uncertainty in a working scene and opens a focused inquiry" do
    context = Context.create!(name: "Interface research", kind: "temporary")
    scene = Scene.create!(
      scene_key: "investigation:dynamic-interface",
      kind: "investigation",
      status: "active",
      title: "The interface is not dynamic yet",
      context: context
    )
    item = activate_surface(
      scene: scene,
      mode: "investigation",
      kind: "question",
      intent: "investigate",
      renderer: "investigation_scene",
      metadata: {
        "known" => [ "The renderer changes content." ],
        "unknown" => [ "The shell still looks fixed." ],
        "next_question" => "Which fixed shell is suppressing the scene?"
      },
      actions: [
        {
          "id" => "investigate",
          "label" => "Investigate",
          "payload" => { "question" => "Which fixed shell is suppressing the scene?" }
        }
      ],
      context_refs: [ { "type" => "context", "id" => context.id } ]
    )

    visit root_path

    assert_selector "#surface_plane[data-surface-composition='working_scene']"
    assert_selector ".surface-object[data-role='focus'] .working-scene"
    assert_selector ".editorial-object__eyebrow", text: /\AInvestigation\z/i
    assert_selector ".editorial-object__eyebrow", text: /\AWhat we know\z/i
    assert_selector ".editorial-object__eyebrow", text: /\AWhat remains uncertain\z/i
    assert_text "Which fixed shell"
    click_on "Investigate"

    assert_current_path root_path
    assert_text "Which fixed shell is suppressing the scene?"
    assert_selector "form[action$='/messages']"
    conversation = Conversation.where(context: context).order(:created_at).last
    assert_selector "form[action='#{conversation_messages_path(conversation)}']"
    assert_equal "discussed", item.surface_feedbacks.last.signal
  end

  test "action mode uses a working scene and stops at confirmation before execution" do
    project = Project.create!(name: "Flyd", root_path: "/tmp/flyd")
    conversation = Conversation.start!(project, summary: "Build the dynamic director")
    scene = Scene.create!(
      scene_key: "action:dynamic-director",
      kind: "build",
      status: "active",
      title: "Build the interface director",
      project: project,
      conversation: conversation
    )
    item = activate_surface(
      scene: scene,
      mode: "action",
      kind: "artifact",
      intent: "build",
      renderer: "action_scene",
      metadata: {
        "proposed_action" => "Implement the dynamic director and its tests.",
        "impact" => "The root surface will direct the present situation.",
        "readiness" => "ready"
      },
      actions: [
        {
          "id" => "build",
          "label" => "Review action",
          "payload" => {
            "project_id" => project.id,
            "conversation_id" => conversation.id,
            "instructions" => "Implement the dynamic director and its tests."
          }
        }
      ],
      context_refs: [ { "type" => "project", "id" => project.id } ]
    )

    visit root_path

    assert_selector "#surface_plane[data-surface-composition='working_scene']"
    assert_selector ".surface-object[data-role='focus'] .working-scene"
    assert_selector ".editorial-object__eyebrow", text: /\AReady to act\z/i
    assert_selector ".editorial-object__eyebrow", text: /\AWhat Flyd will do\z/i
    assert_selector ".editorial-object__eyebrow", text: /\AWhat changes\z/i
    click_on "Review action"

    assert_text(/Review before running/i)
    assert_text "Nothing has executed yet"
    build = item.reload.scene.builds.order(:created_at).last
    assert_current_path build_path(build)
    assert_equal "proposed", build.status
    assert_nil build.confirmed_at
  end

  test "decision mode renders an editorial comparison wall" do
    context = Context.create!(name: "Poster direction", kind: "temporary")
    scene = Scene.create!(
      scene_key: "decision:poster-direction",
      kind: "decision",
      status: "active",
      title: "Choose the stronger direction",
      context: context
    )
    activate_surface(
      scene: scene,
      mode: "decision",
      kind: "decision",
      intent: "decide",
      renderer: "decision_scene",
      metadata: {
        "recommendation" => "Use the darker direction.",
        "options" => [
          { "id" => "dark", "label" => "Darker poster", "description" => "Reads as an evening market." },
          { "id" => "bright", "label" => "Bright poster", "description" => "Reads as a family fair." }
        ]
      },
      actions: [
        { "id" => "choose", "label" => "Choose darker", "payload" => { "option_id" => "dark" } },
        { "id" => "choose", "label" => "Choose bright", "payload" => { "option_id" => "bright" } }
      ],
      context_refs: [ { "type" => "context", "id" => context.id } ]
    )

    visit root_path

    assert_selector "#surface_plane[data-surface-composition='comparison_wall']"
    assert_selector ".surface-object[data-role='focus'] .decision-wall"
    assert_selector ".decision-poster", count: 2
    assert_selector ".decision-poster[data-recommended='true']", count: 1
    assert_selector ".decision-poster[data-recommended='true']", text: "Darker poster"
    assert_selector ".decision-poster[data-recommended='false']", text: "Bright poster"
    assert_text "Use the darker direction."
    assert_button "Accept", count: 1
    assert_button "Choose", count: 1
  end

  private

  def activate_surface(scene:, mode:, kind:, intent:, renderer:, metadata:, actions:, context_refs:)
    surface = Surface.create!(
      status: "draft",
      understanding: "A directed scene is warranted.",
      current_intention: "Resolve the present situation.",
      focus_item_key: scene.scene_key,
      generated_at: Time.current,
      composition_version: "test-directed",
      metadata: { "surface_mode" => mode }
    )
    item = surface.surface_items.create!(
      scene: scene,
      item_key: scene.scene_key,
      kind: kind,
      intent: intent,
      renderer: renderer,
      depth: "foreground",
      state: "presented",
      title: scene.title,
      summary: scene.summary.presence || "The scene needs a directed interface.",
      position: 0,
      context_refs: context_refs,
      metadata: metadata,
      actions: actions
    )
    Surface.activate!(surface)
    item
  end
end
