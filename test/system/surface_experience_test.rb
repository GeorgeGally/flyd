require "application_system_test_case"
require "base64"

class SurfaceExperienceTest < ApplicationSystemTestCase
  setup do
    SurfaceItem.delete_all
    Surface.delete_all
    Rails.cache.clear
  end

  test "root presents the universal composer and prepared scene" do
    Surface.fallback!

    visit root_path

    assert_selector "textarea[placeholder='Ask, tell, show…']"
    assert_text "What deserves your attention?"
    assert_no_selector "aside"
  end

  test "a decision takes over the surface instead of reopening recent chat" do
    project = Project.create!(name: "Directed Flyd")
    conversation = Conversation.start!(project, summary: "An older conversation")
    scene = Scene.create!(
      scene_key: "decision:dynamic-interface",
      kind: "decision",
      status: "active",
      title: "What should the interface become?",
      project: project,
      conversation: conversation
    )
    activate_surface(
      title: scene.title,
      renderer: "decision_scene",
      surface_mode: "decision",
      scene: scene,
      kind: "decision",
      intent: "decide",
      metadata: {
        "options" => [
          { "id" => "director", "label" => "Dynamic director", "description" => "The interface changes around the moment." },
          { "id" => "chat", "label" => "Chat shell", "description" => "The last conversation remains primary." }
        ],
        "recommendation" => "Use the dynamic director."
      },
      actions: [
        { "id" => "choose", "label" => "Choose director", "payload" => { "option_id" => "director", "option_label" => "Dynamic director" } },
        { "id" => "choose", "label" => "Choose chat", "payload" => { "option_id" => "chat", "option_label" => "Chat shell" } }
      ]
    )

    visit root_path

    assert_text "DECISION"
    assert_text "Dynamic director"
    assert_no_text "An older conversation"
    assert_equal "decision", find("#surface_plane")[:"data-surface-mode"]
    assert page.evaluate_script("document.querySelector('#surface_plane').compareDocumentPosition(document.querySelector('[data-surface-target=\"intent\"]')) & Node.DOCUMENT_POSITION_FOLLOWING")

    click_on "Accept"

    assert_no_text scene.title
    assert_equal "resolved", scene.reload.status
    assert_equal "Dynamic director", scene.resolved_artifact.content
  end

  test "an unresolved intent can create and continue in a temporary context" do
    Surface.fallback!
    intent = Intent.create!(
      input_text: "A short-lived cross-project question",
      status: "clarification_required",
      context_candidates: []
    )

    visit root_path(intent_id: intent.id)
    find("summary", text: "Create a temporary context").click
    fill_in "Context name", with: "Interface sprint"
    fill_in "What is this context?", with: "Resolve the interaction model without creating a project."
    click_on "Create"

    assert_text "INTERFACE SPRINT"
    context = Context.find_by!(name: "Interface sprint")
    conversation = Conversation.active_for(context).first!
    assert_selector "form[action='#{conversation_messages_path(conversation)}']"
    assert_equal conversation, intent.reload.conversation
    assert_nil conversation.project
  end

  test "dismissed scenes leave the plane immediately without waiting for composition" do
    item = activate_surface(
      title: "This scene is no longer useful",
      renderer: "hero_scene",
      actions: [{ "id" => "dismiss", "label" => "Dismiss", "payload" => {} }]
    )

    visit root_path
    assert_text item.title
    click_on "Dismiss"

    assert_no_text item.title
    assert_equal "dismissed", item.reload.state
  end

  test "semantic layout is restored after Turbo morphs the surface" do
    focus = activate_surface(
      title: "Primary decision",
      renderer: "hero_scene",
      surface_mode: "decision",
      kind: "decision",
      intent: "decide"
    )
    support = focus.surface.items.create!(
      item_key: "supporting-signal",
      kind: "status",
      intent: "monitor",
      renderer: "notification",
      depth: "background",
      state: "presented",
      title: "Supporting signal",
      summary: "Secondary evidence.",
      position: 1
    )

    visit root_path
    find("textarea[aria-label='Tell Flyd what is happening']").click
    support_selector = "[data-item-key='#{support.item_key}']"
    assert_selector "#{support_selector}.opacity-35"

    page.execute_script(<<~JS)
      document.querySelector(#{support_selector.to_json}).classList.remove("opacity-35")
      document.dispatchEvent(new CustomEvent("turbo:morph"))
    JS

    assert_selector "#{support_selector}.opacity-35"
  end

  test "media scenes render bytes from Active Storage" do
    intent = Intent.create!(input_text: "Show the image")
    attachment = intent.intent_attachments.create!(
      modality: "image",
      filename: "pixel.png",
      content_type: "image/png",
      byte_size: 68,
      checksum: "system-pixel",
      expires_at: 1.day.from_now
    )
    attachment.file.attach(
      io: StringIO.new(Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4WQAAAAASUVORK5CYII=")),
      filename: "pixel.png",
      content_type: "image/png",
      identify: false
    )
    activate_surface(
      title: "Visual evidence",
      renderer: "media",
      source_refs: [{ "type" => "intent_attachment", "id" => attachment.id }],
      metadata: { "media_type" => "image", "attachment_id" => attachment.id }
    )

    visit root_path

    assert_selector "img[alt='Visual evidence'][src='#{intent_attachment_path(attachment)}']"
  end

  private

  def activate_surface(title:, renderer:, actions: [], source_refs: [], metadata: {}, surface_mode: "quiet", scene: nil, kind: nil, intent: nil)
    surface = Surface.create!(
      status: "draft",
      understanding: "A system-test scene.",
      current_intention: "Prove the surface contract.",
      focus_item_key: scene&.scene_key || "system-scene",
      composition_version: "system-test",
      metadata: { "surface_mode" => surface_mode }
    )
    item = surface.items.create!(
      scene: scene,
      item_key: scene&.scene_key || "system-scene",
      kind: kind || (renderer == "media" ? "artifact" : "scene"),
      intent: intent || "inform",
      renderer: renderer,
      depth: "foreground",
      state: "presented",
      title: title,
      summary: "System-test content.",
      position: 0,
      source_refs: source_refs,
      actions: actions,
      metadata: metadata
    )
    Surface.activate!(surface)
    item
  end
end
