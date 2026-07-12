require "application_system_test_case"
require "base64"

class SurfaceExperienceTest < ApplicationSystemTestCase
  setup do
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

    assert_text "Context: Interface sprint"
    assert_equal "Interface sprint", intent.reload.conversation.context.name
    assert_nil intent.conversation.project
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

  def activate_surface(title:, renderer:, actions: [], source_refs: [], metadata: {})
    surface = Surface.create!(
      status: "draft",
      understanding: "A system-test scene.",
      current_intention: "Prove the surface contract.",
      focus_item_key: "system-scene",
      composition_version: "system-test"
    )
    item = surface.items.create!(
      item_key: "system-scene",
      kind: renderer == "media" ? "artifact" : "scene",
      intent: "inform",
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
