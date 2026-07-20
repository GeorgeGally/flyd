require "test_helper"

class Flyd::IntelligenceTest < ActiveSupport::TestCase
  FakeChat = Struct.new(:response, :received_messages) do
    def call!(messages)
      self.received_messages = messages
      response
    end
  end

  SequenceChat = Struct.new(:responses, :received_calls) do
    def call!(messages)
      self.received_calls ||= []
      received_calls << messages
      responses.shift
    end
  end

  FakeStateProvider = Struct.new(:payload) do
    def snapshot = payload
  end

  test "Flyd chooses and composes the interface required by the situation" do
    project = Project.create!(name: "Flyd", description: "Personal intelligence")
    Scene.create!(
      scene_key: "interface-drift",
      kind: "decision",
      status: "active",
      title: "What should become the primary interface?",
      summary: "Choose whether Flyd directs the surface or remains a conversation shell.",
      project: project
    )
    response = {
      understanding: "The implementation has drifted back toward chat-first interaction.",
      current_intention: "Put the architectural choice directly on screen.",
      surface_mode: "decision",
      focus_item_id: "interface-drift",
      items: [ {
        id: "interface-drift",
        kind: "decision",
        intent: "decide",
        title: "What should become the primary interface?",
        summary: "Choose whether Flyd directs the surface or remains a conversation shell.",
        renderer: "decision_scene",
        depth: "foreground",
        context_refs: [ { type: "project", id: project.id } ],
        source_refs: [ { type: "goal", id: "goal:ship-flyd" } ],
        metadata: {
          options: [
            { id: "director", label: "Dynamic director", description: "The interface changes around the situation." },
            { id: "shell", label: "Conversation shell", description: "The last conversation remains primary." }
          ],
          recommendation: "Use the dynamic director."
        },
        actions: [
          { id: "choose", label: "Choose dynamic director", payload: { option_id: "director", option_label: "Dynamic director" } },
          { id: "choose", label: "Choose conversation shell", payload: { option_id: "shell", option_label: "Conversation shell" } }
        ]
      } ],
      relationships: []
    }.to_json
    chat = FakeChat.new(response)
    provider = FakeStateProvider.new({
      providers: [ {
        source: "flyd-cli",
        fresh: true,
        errors: [],
        data: {
          goals: [ {
            id: "goal:ship-flyd",
            type: "goal",
            source: "test",
            epistemicStatus: "user_confirmed",
            confidence: 0.9,
            generatedAt: Time.current.iso8601,
            evidenceRefs: [ { type: "event", id: "event:setup" } ],
            content: { slug: "ship-flyd" }
          } ]
        }
      } ]
    })

    surface = Flyd::Intelligence.new(chat: chat, state_provider: provider).compose_surface
    sent_state = JSON.parse(chat.received_messages.last[:content])

    assert_equal "decision", surface.surface_mode
    assert_equal "interface-drift", surface.focus_item_id
    assert_equal "decision_scene", surface.items.first.renderer
    assert_equal "ship-flyd", sent_state.dig("provider_state", "providers", 0, "data", "goals", 0, "content", "slug")
    assert_equal "decision", sent_state.dig("interface_direction", "suggested_mode")
    assert_equal "interface-drift", sent_state.dig("interface_direction", "suggested_focus_scene_key")
    assert_equal "Make the choice itself the interface.", sent_state.dig("interface_direction", "grammars", "decision", "purpose")
    assert_includes chat.received_messages.first[:content], '"attachment_id":"optional exact intent attachment id"'
  end

  test "provider evidence composes a directed surface without a prebuilt scene" do
    response = {
      understanding: "Setup abandonment is unresolved and the current explanation lacks direct observations.",
      current_intention: "Investigate the exact point where setup loses users.",
      surface_mode: "investigation",
      focus_item_id: "investigation:setup-abandonment",
      items: [ {
        id: "investigation:setup-abandonment",
        kind: "question",
        intent: "investigate",
        title: "Where does setup lose people?",
        summary: "The current evidence points to broad choices, but no recent setup-session observations confirm the cause.",
        renderer: "investigation_scene",
        depth: "foreground",
        context_refs: [],
        source_refs: [
          { type: "curiosity", id: "curiosity:adoption" },
          { type: "signal", id: "signal:setup" }
        ],
        metadata: {
          known: [ "Users face a broad set of setup choices." ],
          unknown: [ "The exact step where users abandon setup." ],
          next_question: "Which setup step has the highest abandonment rate?"
        },
        actions: [ {
          id: "investigate",
          label: "Investigate setup sessions",
          payload: { question: "Which setup step has the highest abandonment rate?" }
        } ]
      } ],
      relationships: []
    }.to_json
    chat = FakeChat.new(response)
    provider = FakeStateProvider.new({
      providers: [ {
        source: "flyd-cli",
        fresh: true,
        errors: [],
        data: {
          curiosity: [ {
            id: "curiosity:adoption",
            type: "curiosity",
            source: "test",
            epistemicStatus: "llm_generated",
            confidence: 0.7,
            generatedAt: Time.current.iso8601,
            evidenceRefs: [ { type: "event", id: "event:setup" } ],
            content: {
              question: "Why are users abandoning setup?",
              missingEvidence: "Recent setup-session observations"
            }
          } ],
          signals: [ {
            id: "signal:setup",
            type: "signal",
            source: "test",
            epistemicStatus: "heuristic",
            confidence: 0.6,
            generatedAt: Time.current.iso8601,
            evidenceRefs: [ { type: "event", id: "event:setup" } ],
            content: { topic: "setup", unresolved: 2 }
          } ]
        }
      } ]
    })

    surface = Flyd::Intelligence.new(chat: chat, state_provider: provider).compose_surface
    sent_state = JSON.parse(chat.received_messages.last[:content])
    system_prompt = chat.received_messages.first[:content]

    assert_equal "investigation", surface.surface_mode
    assert_equal "investigation_scene", surface.items.first.renderer
    assert_equal [ "curiosity", "signal" ], surface.items.first.source_refs.map { |reference| reference["type"] }
    assert_not_equal "quiet:available", surface.focus_item_id
    assert_not_equal "What deserves your attention?", surface.items.first.title
    assert_includes sent_state.dig("interface_direction", "candidates").map { |candidate| candidate["mode"] }, "investigation"
    assert_includes system_prompt, "Quiet is valid only when no candidate evidence supports a concrete present situation."
    assert_includes system_prompt, "candidate evidence_refs"
    assert_includes system_prompt, 'investigate action payload must be {"question":"metadata.next_question"}'
  end

  test "repairs one structurally invalid directed surface" do
    invalid_response = {
      understanding: "The setup problem needs investigation.",
      current_intention: "Find the abandonment point.",
      surface_mode: "investigation",
      focus_item_id: "curiosity:adoption",
      items: [ {
        id: "curiosity:adoption",
        kind: "curiosity",
        intent: "investigate",
        title: "Where does setup lose people?",
        summary: "Recent setup observations are missing.",
        renderer: "investigation_scene",
        depth: "foreground",
        context_refs: [],
        source_refs: [ { type: "curiosity", id: "curiosity:adoption" } ],
        metadata: {
          known: [ "Setup offers broad choices." ],
          unknown: [ "The abandonment point." ],
          next_question: "Which setup step loses users?"
        },
        actions: [ { id: "investigate", label: "Investigate", payload: {} } ]
      } ],
      relationships: []
    }.to_json
    corrected_response = {
      understanding: "The setup problem needs investigation.",
      current_intention: "Find the abandonment point.",
      surface_mode: "investigation",
      focus_item_id: "investigation:setup",
      items: [ {
        id: "investigation:setup",
        kind: "question",
        intent: "investigate",
        title: "Where does setup lose people?",
        summary: "Recent setup observations are missing.",
        renderer: "investigation_scene",
        depth: "foreground",
        context_refs: [],
        source_refs: [ { type: "curiosity", id: "curiosity:adoption" } ],
        metadata: {
          known: [ "Setup offers broad choices." ],
          unknown: [ "The abandonment point." ],
          next_question: "Which setup step loses users?"
        },
        actions: [ {
          id: "investigate",
          label: "Investigate",
          payload: { question: "Which setup step loses users?" }
        } ]
      } ],
      relationships: []
    }.to_json
    chat = SequenceChat.new([ invalid_response, corrected_response ])
    provider = FakeStateProvider.new({
      providers: [ {
        source: "flyd-cli",
        fresh: true,
        errors: [],
        data: {
          curiosity: [ {
            id: "curiosity:adoption",
            type: "curiosity",
            source: "test",
            epistemicStatus: "llm_generated",
            confidence: 0.7,
            generatedAt: Time.current.iso8601,
            evidenceRefs: [ { type: "event", id: "event:setup" } ],
            content: {
              question: "Why are users abandoning setup?",
              missingEvidence: "Recent setup-session observations"
            }
          } ]
        }
      } ]
    })

    surface = Flyd::Intelligence.new(chat: chat, state_provider: provider, fallback: false).compose_surface

    assert_equal "investigation", surface.surface_mode
    assert_equal "question", surface.items.first.kind
    assert_equal 2, chat.received_calls.length
    repair_request = chat.received_calls.second.last[:content]
    assert_includes repair_request, "Unsupported kind: curiosity"
    assert_includes repair_request, "Investigation requires a question"
    repair_instruction = chat.received_calls.second.first[:content]
    assert_includes repair_instruction, "Required surface mode: investigation"
    assert_includes repair_instruction, "Do not choose an alternative mode"
  end

  test "raises when the single structural repair is still invalid" do
    invalid_response = {
      understanding: "A question exists.",
      current_intention: "Investigate it.",
      surface_mode: "investigation",
      focus_item_id: "curiosity:adoption",
      items: [ {
        id: "curiosity:adoption",
        kind: "curiosity",
        intent: "investigate",
        title: "What is happening?",
        summary: "The evidence is incomplete.",
        renderer: "investigation_scene",
        depth: "foreground",
        context_refs: [],
        source_refs: [ { type: "curiosity", id: "curiosity:adoption" } ],
        metadata: { known: [ "A symptom exists." ], unknown: [ "Its cause." ], next_question: "Why?" },
        actions: [ { id: "investigate", label: "Investigate", payload: {} } ]
      } ],
      relationships: []
    }.to_json
    chat = SequenceChat.new([ invalid_response, invalid_response ])
    provider = FakeStateProvider.new({
      providers: [ {
        source: "flyd-cli",
        fresh: true,
        errors: [],
        data: {
          curiosity: [ {
            id: "curiosity:adoption",
            type: "curiosity",
            source: "test",
            epistemicStatus: "llm_generated",
            confidence: 0.7,
            generatedAt: Time.current.iso8601,
            evidenceRefs: [ { type: "event", id: "event:setup" } ],
            content: { question: "Why?", missingEvidence: "Direct observation" }
          } ]
        }
      } ]
    })

    assert_raises(Flyd::SurfacePlanValidator::ValidationError) do
      Flyd::Intelligence.new(chat: chat, state_provider: provider, fallback: false).compose_surface
    end
    assert_equal 2, chat.received_calls.length
  end

  test "falls back without ranking database records when composition fails" do
    provider = FakeStateProvider.new({ providers: [] })
    intelligence = Flyd::Intelligence.new(chat: FakeChat.new("not json"), state_provider: provider)
    surface = intelligence.compose_surface

    assert_equal "quiet", surface.surface_mode
    assert_equal "quiet:available", surface.focus_item_id
    assert_equal 1, surface.items.length
    assert_empty surface.items.first.source_refs
    assert intelligence.diagnostics[:state_digest].present?
    assert_equal 0, intelligence.diagnostics[:output_characters]
  end

  test "falls back to the authoritative task scene when runtime evidence exists" do
    provider = FakeStateProvider.new({
      providers: [ {
        source: "flyd-runtime",
        fresh: true,
        data: {
          runtime_tasks: [ {
            id: "task-1",
            type: "runtime_task",
            epistemicStatus: "observation",
            confidence: 1.0,
            generatedAt: Time.current.iso8601,
            content: {
              taskKey: "task-1",
              status: "awaiting_grant",
              revision: 5,
              intendedOutcome: "Ship Rails parity",
              projectId: 42
            }
          } ],
          task_grants: [ {
            id: "grant-1",
            type: "task_grant",
            epistemicStatus: "observation",
            confidence: 1.0,
            generatedAt: Time.current.iso8601,
            content: { taskKey: "task-1", grantKey: "grant-1", status: "proposed" }
          } ]
        }
      } ]
    })

    intelligence = Flyd::Intelligence.new(chat: FakeChat.new("not json"), state_provider: provider)
    surface = intelligence.compose_surface

    assert_equal "decision", surface.surface_mode
    assert_equal "task_plan", surface.items.first.renderer
    assert_equal 5, surface.items.first.metadata["task_revision"]
    assert_equal %w[approve_task_grant reject_task_grant], surface.items.first.actions.pluck("id")
    assert_includes surface.items.first.source_refs, { "type" => "runtime_task", "id" => "task-1" }
    assert intelligence.diagnostics[:state_digest].present?
    assert_equal 0, intelligence.diagnostics[:output_characters]
  end

  test "fallback does not claim review readiness without a verified artifact" do
    provider = FakeStateProvider.new({
      providers: [ {
        source: "flyd-runtime",
        fresh: true,
        data: {
          runtime_tasks: [ {
            id: "task-1",
            type: "runtime_task",
            epistemicStatus: "observation",
            confidence: 1.0,
            generatedAt: Time.current.iso8601,
            content: {
              taskKey: "task-1",
              status: "ready",
              revision: 8,
              intendedOutcome: "Assess the project",
              recommendedNextAction: "Resume the interrupted assessment"
            }
          } ],
          task_assignments: [ {
            id: "assignment-1",
            type: "task_assignment",
            epistemicStatus: "observation",
            confidence: 1.0,
            generatedAt: Time.current.iso8601,
            content: { taskKey: "task-1", status: "running", title: "Assess the project" }
          } ],
          task_artifacts: []
        }
      } ]
    })

    surface = Flyd::Intelligence.new(chat: FakeChat.new("not json"), state_provider: provider).compose_surface

    assert_equal "action", surface.surface_mode
    assert_equal "task_orientation", surface.items.first.renderer
    assert_equal "Resume the interrupted assessment", surface.items.first.summary
    assert_empty surface.items.first.actions
  end

  test "stays intentionally quiet without asking the model to invent relevance" do
    chat = FakeChat.new("must not be called")
    provider = FakeStateProvider.new({ providers: [] })

    surface = Flyd::Intelligence.new(chat: chat, state_provider: provider, fallback: false).compose_surface

    assert_equal "quiet", surface.surface_mode
    assert_equal "quiet:available", surface.focus_item_id
    assert_nil chat.received_messages
    assert_equal "Flyd is ready when you are.", surface.understanding
  end


  test "grounded archive knowledge composes a discovery instead of quiet" do
    response = {
      understanding: "A foundational idea in the archive directly connects to Flyd's current direction.",
      current_intention: "Resurface a useful connection without manufacturing urgency.",
      surface_mode: "discovery",
      focus_item_id: "discovery:memex",
      items: [ {
        id: "discovery:memex",
        kind: "insight",
        intent: "inform",
        title: "The memex was designed around associative trails",
        summary: "Vannevar Bush described a personal system where linked trails mirror how memory moves between ideas.",
        renderer: "discovery_scene",
        depth: "foreground",
        context_refs: [],
        source_refs: [ { type: "report", id: "report:memex" } ],
        actions: [ { id: "inspect_sources", label: "Open source", payload: {} } ],
        metadata: {
          why_it_matters: "Flyd's stage can make those associations actionable instead of merely searchable.",
          source_label: "From your archive"
        }
      } ],
      relationships: []
    }.to_json
    chat = FakeChat.new(response)
    provider = FakeStateProvider.new({
      providers: [ {
        source: "flyd-cli",
        fresh: true,
        data: {
          reports: [ {
            id: "report:memex", type: "report", source: "cli.reports", epistemicStatus: "observation",
            confidence: 0.8, generatedAt: nil, evidenceRefs: [],
            content: { title: "The memex", excerpt: "Associative trails anticipated hypertext." }
          } ]
        }
      } ]
    })

    surface = Flyd::Intelligence.new(chat: chat, state_provider: provider, fallback: false).compose_surface

    assert_equal "discovery", surface.surface_mode
    assert_equal "discovery_scene", surface.items.first.renderer
    assert_equal [ { "type" => "report", "id" => "report:memex" } ], surface.items.first.source_refs
  end
end
