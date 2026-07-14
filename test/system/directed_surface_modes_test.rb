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
        },
        { "id" => "inspect_sources", "label" => "Inspect evidence", "payload" => {} }
      ],
      context_refs: [ { "type" => "context", "id" => context.id } ]
    )

    visit root_path

    assert_selector "#surface_plane[data-surface-composition='working_scene']"
    assert_selector ".surface-object[data-role='focus'] .working-scene"
    assert_selector ".surface-label", text: /\AInvestigation\z/i
    assert_selector ".surface-label", text: /\AWhat we know\z/i
    assert_selector ".surface-label", text: /\AWhat remains uncertain\z/i
    assert_link "Inspect evidence"
    assert_text "Which fixed shell"
    plane_width = page.evaluate_script("document.querySelector('#surface_plane').getBoundingClientRect().width")
    focus_width = page.evaluate_script("document.querySelector('.surface-object[data-role=\"focus\"]').getBoundingClientRect().width")
    primary_left = page.evaluate_script("document.querySelector('.working-scene__primary').getBoundingClientRect().left")
    secondary_left = page.evaluate_script("document.querySelector('.working-scene__secondary').getBoundingClientRect().left")

    assert_operator focus_width, :>, plane_width * 0.9
    assert_operator secondary_left, :>, primary_left
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
        },
        { "id" => "dismiss", "label" => "Not now", "payload" => {} }
      ],
      context_refs: [ { "type" => "project", "id" => project.id } ]
    )

    visit root_path

    assert_selector "#surface_plane[data-surface-composition='working_scene']"
    assert_selector ".surface-object[data-role='focus'] .working-scene"
    assert_selector ".surface-label", text: /\AReady to act\z/i
    assert_selector ".surface-label", text: /\AWhat Flyd will do\z/i
    assert_selector ".surface-label", text: /\AWhat changes\z/i
    assert_button "Not now"
    click_on "Review action"

    assert_text(/Review before running/i)
    assert_text "Nothing has executed yet"
    build = item.reload.scene.builds.order(:created_at).last
    assert_current_path build_path(build)
    assert_equal "proposed", build.status
    assert_nil build.confirmed_at
  end

  test "support working scenes scale titles to their container without clipping" do
    focus_scene = Scene.create!(
      scene_key: "investigation:user-engagement",
      kind: "investigation",
      status: "active",
      title: "What factors are contributing to the unresolved issue in user engagement?"
    )
    focus_item = activate_surface(
      scene: focus_scene,
      mode: "investigation",
      kind: "question",
      intent: "investigate",
      renderer: "investigation_scene",
      metadata: {
        "known" => [ "The issue is unresolved." ],
        "unknown" => [ "The cause is unclear." ],
        "next_question" => "What evidence would resolve it?"
      },
      actions: [ {
        "id" => "investigate",
        "label" => "Investigate",
        "payload" => { "question" => "What evidence would resolve it?" }
      } ],
      context_refs: []
    )
    focus_item.surface.surface_items.create!(
      item_key: "investigation:content-quality",
      kind: "question",
      intent: "investigate",
      renderer: "investigation_scene",
      depth: "middle",
      state: "presented",
      title: "How can we address the declining activity in content quality and its unresolved blocker?",
      summary: "The evidence is incomplete.",
      position: 1,
      context_refs: [],
      metadata: {
        "known" => [ "Quality is declining." ],
        "unknown" => [ "The blocker is unclear." ],
        "next_question" => "Which metric identifies the blocker?"
      },
      actions: [ {
        "id" => "investigate",
        "label" => "Investigate quality",
        "payload" => { "question" => "Which metric identifies the blocker?" }
      } ]
    )

    visit root_path

    focus_title_size = page.evaluate_script(<<~JS)
      parseFloat(getComputedStyle(document.querySelector('.surface-object[data-role="focus"] .working-scene h2')).fontSize)
    JS
    support_title_size = page.evaluate_script(<<~JS)
      parseFloat(getComputedStyle(document.querySelector('.surface-object[data-role="support"] .working-scene h2')).fontSize)
    JS
    support_title_fits = page.evaluate_script(<<~JS)
      (() => {
        const title = document.querySelector('.surface-object[data-role="support"] .working-scene h2')
        return title.scrollWidth <= title.clientWidth
      })()
    JS

    assert_operator support_title_size, :<, focus_title_size
    assert support_title_fits
  end

  test "decision mode renders an unframed comparison field" do
    dark = image_attachment("dark.png", "decision-dark")
    bright = image_attachment("bright.png", "decision-bright")
    context = Context.create!(name: "Visual direction", kind: "temporary")
    scene = Scene.create!(
      scene_key: "decision:visual-direction",
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
          { "id" => "dark", "label" => "Darker direction", "description" => "Reads as an evening market.", "attachment_id" => dark.id },
          { "id" => "bright", "label" => "Bright direction", "description" => "Reads as a family fair.", "attachment_id" => bright.id }
        ]
      },
      actions: [
        { "id" => "choose", "label" => "Choose darker", "payload" => { "option_id" => "dark" } },
        { "id" => "choose", "label" => "Choose bright", "payload" => { "option_id" => "bright" } },
        { "id" => "discuss", "label" => "Talk it through", "payload" => {} }
      ],
      context_refs: [ { "type" => "context", "id" => context.id } ],
      source_refs: [
        { "type" => "intent_attachment", "id" => dark.id },
        { "type" => "intent_attachment", "id" => bright.id }
      ]
    )

    visit root_path

    assert_selector "#surface_plane[data-surface-composition='comparison_wall']"
    assert_selector ".surface-object[data-role='focus'] .decision-field"
    assert_selector ".decision-option", count: 2
    assert_selector ".decision-option[data-recommended='true']", count: 1
    assert_selector ".decision-option[data-recommended='true']", text: "Darker direction"
    assert_selector ".decision-option[data-recommended='false']", text: "Bright direction"
    assert_selector "img[src='#{intent_attachment_path(dark)}'][alt='Darker direction']"
    assert_selector "img[src='#{intent_attachment_path(bright)}'][alt='Bright direction']"
    assert_text "Use the darker direction."
    assert_button "Talk it through"
    assert_button "Accept", count: 1
    assert_button "Choose", count: 1
    option_shadow = page.evaluate_script("getComputedStyle(document.querySelector('.decision-option')).boxShadow")
    field_border = page.evaluate_script("getComputedStyle(document.querySelector('.decision-field')).borderTopWidth")
    assert_equal "none", option_shadow
    assert_equal "0px", field_border
  end

  test "discovery gives grounded knowledge its own fixed stage" do
    scene = Scene.create!(
      scene_key: "discovery:memex",
      kind: "work",
      status: "active",
      title: "The memex was designed around associative trails"
    )
    activate_surface(
      scene: scene,
      mode: "discovery",
      kind: "insight",
      intent: "inform",
      renderer: "discovery_scene",
      metadata: {
        "source_label" => "From your archive",
        "why_it_matters" => "This is the conceptual bridge between stored memory and Flyd's generated interface."
      },
      actions: [ { "id" => "inspect_sources", "label" => "Open source", "payload" => {} } ],
      context_refs: [],
      source_refs: [ { "type" => "report", "id" => "report:memex" } ]
    )

    visit root_path

    assert_selector "#surface_plane[data-surface-mode='discovery']"
    assert_selector ".discovery-scene", text: "The memex was designed around associative trails"
    assert_text "From your archive"
    assert_link "Open source"
    assert page.evaluate_script("document.scrollingElement.scrollHeight <= window.innerHeight + 1")
  end

  private

  def activate_surface(scene:, mode:, kind:, intent:, renderer:, metadata:, actions:, context_refs:, source_refs: [])
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
      source_refs: source_refs,
      metadata: metadata,
      actions: actions
    )
    Surface.activate!(surface)
    item
  end

  def image_attachment(filename, checksum)
    intent = Intent.create!(input_text: "Compare #{filename}")
    attachment = intent.intent_attachments.create!(
      modality: "image",
      filename: filename,
      content_type: "image/png",
      byte_size: 68,
      checksum: checksum,
      expires_at: 1.day.from_now
    )
    attachment.file.attach(
      io: StringIO.new(Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4WQAAAAASUVORK5CYII=")),
      filename: filename,
      content_type: "image/png",
      identify: false
    )
    attachment
  end
end
