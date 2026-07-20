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

  test "task review puts the verified worker conclusion on the stage" do
    project = Project.create!(name: "Flyd runtime", root_path: Dir.home)
    task = project.agent_tasks.create!(
      status: "ready",
      intended_outcome: "Assess the current project status"
    )
    assignment = task.task_assignments.create!(
      status: "integrated",
      title: "Assess the project",
      instructions: "Return the grounded conclusion"
    )
    conclusion = task.task_artifacts.create!(
      task_assignment: assignment,
      kind: "log",
      title: "Worker result",
      media_type: "text/markdown",
      byte_size: 76,
      sha256_digest: Digest::SHA256.hexdigest("release-status"),
      verification_status: "verified",
      source_revision: task.revision,
      content: "## Current status\n\nRelease 1C is implemented. Real dogfood evidence remains.",
      provenance: {}
    )
    check = task.task_artifacts.create!(
      task_assignment: assignment,
      kind: "test",
      title: "git diff --check",
      media_type: "text/plain",
      byte_size: 6,
      sha256_digest: Digest::SHA256.hexdigest("exit 0"),
      verification_status: "verified",
      source_revision: task.revision,
      content: "exit 0",
      provenance: {}
    )
    RuntimeDeliveryState.create!(
      listener_key: AgentRuntime::EventListener::LISTENER_KEY,
      lease_owner: "system-test-listener",
      lease_expires_at: 1.minute.from_now,
      last_event_id: 0
    )
    scene = Scene.create!(
      scene_key: "task-review:#{task.task_key}",
      kind: "work",
      status: "active",
      title: task.intended_outcome,
      project: project
    )
    activate_surface(
      scene: scene,
      mode: "action",
      kind: "artifact",
      intent: "review",
      renderer: "task_review",
      metadata: { "task_revision" => task.revision },
      actions: [],
      context_refs: [ { "type" => "project", "id" => project.id } ],
      source_refs: [
        { "type" => "runtime_task", "id" => task.task_key },
        { "type" => "task_assignment", "id" => assignment.assignment_key },
        { "type" => "task_artifact", "id" => conclusion.artifact_key },
        { "type" => "task_artifact", "id" => check.artifact_key }
      ]
    )

    visit root_path

    assert_selector ".task-outcome", text: "Release 1C is implemented"
    assert_selector ".task-outcome h2", text: "Current status"
    assert_link "git diff --check"
    assert_no_text "The assignments have returned verified artifacts"
    assert page.evaluate_script("document.scrollingElement.scrollHeight <= window.innerHeight + 1")
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
        { "id" => "choose", "label" => "Choose darker", "payload" => { "option_id" => "dark", "option_label" => "Darker direction" } },
        { "id" => "choose", "label" => "Choose bright", "payload" => { "option_id" => "bright", "option_label" => "Bright direction" } },
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

    click_on "Choose"
    assert_current_path root_path
    assert_no_text "Choose the stronger direction"
  end

  test "decision mode stays neutral when Flyd makes no recommendation" do
    scene = Scene.create!(
      scene_key: "decision:neutral",
      kind: "decision",
      status: "active",
      title: "Choose without a recommendation"
    )
    activate_surface(
      scene: scene,
      mode: "decision",
      kind: "decision",
      intent: "decide",
      renderer: "decision_scene",
      metadata: {
        "options" => [
          { "id" => "one", "label" => "First option", "description" => "One valid direction." },
          { "id" => "two", "label" => "Second option", "description" => "Another valid direction." }
        ]
      },
      actions: [
        { "id" => "choose", "label" => "Choose first", "payload" => { "option_id" => "one", "option_label" => "First option" } },
        { "id" => "choose", "label" => "Choose second", "payload" => { "option_id" => "two", "option_label" => "Second option" } }
      ],
      context_refs: []
    )

    visit root_path

    assert_no_text "Recommended"
    assert_no_button "Accept"
    assert_button "Choose", count: 2
    assert_selector ".decision-option[data-recommended='false']", count: 2
  end

  test "action mode distinguishes blocked and running work from ready proposals" do
    blocked_scene = Scene.create!(
      scene_key: "action:blocked",
      kind: "build",
      status: "active",
      title: "Waiting for repository access"
    )
    activate_surface(
      scene: blocked_scene,
      mode: "action",
      kind: "scene",
      intent: "build",
      renderer: "action_scene",
      metadata: {
        "proposed_action" => "Update the protected repository.",
        "impact" => "The release can proceed once access is restored.",
        "readiness" => "blocked"
      },
      actions: [],
      context_refs: []
    )

    visit root_path

    assert_selector ".surface-label", text: /Blocked/i
    assert_no_text "Ready to act"
    assert_no_button "Review action"
    assert_text "Flyd will not offer execution until the blocker is resolved."

    running_scene = Scene.create!(
      scene_key: "action:running",
      kind: "build",
      status: "active",
      title: "Building the action contract"
    )
    activate_surface(
      scene: running_scene,
      mode: "action",
      kind: "scene",
      intent: "build",
      renderer: "action_scene",
      metadata: {
        "proposed_action" => "Run the approved implementation.",
        "impact" => "The verified result will return to Flyd.",
        "readiness" => "running"
      },
      actions: [],
      context_refs: []
    )

    visit root_path

    assert_selector ".surface-label", text: /In progress/i
    assert_no_text "Ready to act"
    assert_no_button "Review action"
    assert_text "Execution is already underway. Flyd will return the outcome to this scene."
  end

  test "discovery composes three grounded objects as a moving poster deck" do
    web_snapshot, = IntelligenceState::WebDiscoveryProvider.new.persist!(
      discoveries: [ {
        "id" => "discovery:hn:memex",
        "type" => "discovery",
        "source" => "web.hacker_news",
        "epistemicStatus" => "observation",
        "confidence" => 0.9,
        "generatedAt" => Time.current.iso8601,
        "evidenceRefs" => [],
        "content" => {
          "title" => "The memex was designed around associative trails",
          "url" => "https://example.com/memex",
          "description" => "A system for following connections through a personal archive.",
          "imageUrl" => "https://example.com/memex.jpg",
          "siteName" => "The Atlantic"
        }
      } ]
    )
    personal_snapshot, = IntelligenceState::PersonalContextProvider.new.persist!(
      activities: [ {
        "id" => "activity:flyd", "type" => "activity", "source" => "local.activity",
        "epistemicStatus" => "observation", "confidence" => 0.95, "generatedAt" => Time.current.iso8601,
        "evidenceRefs" => [], "content" => {
          "title" => "Continue flyd", "description" => "Build the living discovery stage.", "updatedAt" => Time.current.iso8601
        }
      } ],
      horoscopes: [ {
        "id" => "horoscope:aries:today", "type" => "horoscope", "source" => "web.astrology",
        "epistemicStatus" => "observation", "confidence" => 0.9, "generatedAt" => Time.current.iso8601,
        "evidenceRefs" => [], "content" => {
          "title" => "Aries", "description" => "Make room for a creative risk today.",
          "url" => "https://www.astrology.com/horoscope/daily/aries.html", "siteName" => "Astrology.com"
        }
      } ]
    )
    scene = Scene.create!(
      scene_key: "discovery:memex",
      kind: "work",
      status: "active",
      title: "The memex was designed around associative trails"
    )
    item = activate_surface(
      scene: scene,
      mode: "discovery",
      kind: "insight",
      intent: "inform",
      renderer: "discovery_scene",
      metadata: { "variant" => "activity", "provenance" => "499 points · 123 comments" },
      actions: [ { "id" => "inspect_sources", "label" => "Open source", "payload" => {} } ],
      context_refs: [],
      source_refs: [ { "type" => "activity", "id" => "activity:flyd" } ]
    )
    item.update!(title: "Continue flyd", summary: "Build the living discovery stage.")
    item.surface.surface_items.create!(
      item_key: "horoscope:aries", kind: "insight", intent: "inform", renderer: "discovery_scene",
      depth: "middle", state: "presented", title: "Aries", summary: "Make room for a creative risk today.",
      position: 1, source_refs: [ { "type" => "horoscope", "id" => "horoscope:aries:today" } ],
      metadata: { "variant" => "horoscope" }, actions: []
    )
    item.surface.surface_items.create!(
      item_key: "discovery:memex:story", kind: "insight", intent: "inform", renderer: "discovery_scene",
      depth: "background", state: "presented", title: "The memex was designed around associative trails",
      summary: "A system for following connections through a personal archive.", position: 2,
      source_refs: [ { "type" => "discovery", "id" => "discovery:hn:memex" } ],
      metadata: { "variant" => "story", "why_it_matters" => "Model rationale" }, actions: []
    )
    item.surface.update!(metadata: item.surface.metadata.merge(
      "provider_snapshots" => [
        { "source" => "personal-context", "snapshot_id" => personal_snapshot.id },
        { "source" => "web-discovery", "snapshot_id" => web_snapshot.id }
      ]
    ))

    visit root_path

    assert_selector "#surface_plane[data-surface-mode='discovery']"
    assert_selector "#surface_plane[data-surface-composition='poster_deck']"
    assert_selector ".discovery-scene", count: 3
    assert_selector ".discovery-poster", count: 3
    assert_selector ".discovery-poster[data-has-image='false']"
    page.find(".surface-object[data-position='2']").click
    assert_selector ".discovery-poster", text: "A system for following connections through a personal archive."
    assert_text "Continue flyd"
    assert_text "Aries"
    assert_no_text "Evidence"
    assert_no_text "499 points"
    assert_no_text "Model rationale"
    assert_link "Open", href: "https://example.com/memex"
    page.find(".surface-object[data-position='1']").click
    assert_selector ".surface-object[data-position='1'].is-runtime-focus"
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
