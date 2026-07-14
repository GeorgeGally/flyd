require "test_helper"

class Flyd::EvidenceCandidatesTest < ActiveSupport::TestCase
  test "derives justified modes with exact provider evidence references" do
    candidates = Flyd::EvidenceCandidates.call(
      provider_state: {
        providers: [ {
          source: "flyd-cli",
          fresh: true,
          errors: [],
          data: {
            tensions: [ evidence("tension", "tension:launch", { blockers: 1, tension: 0.7 }) ],
            curiosity: [ evidence("curiosity", "curiosity:adoption", {
              question: "Why are users abandoning setup?",
              missingEvidence: "Recent setup-session observations"
            }, epistemic_status: "llm_generated") ],
            signals: [ evidence("signal", "signal:setup", {
              topic: "setup",
              unresolved: 2,
              details: { unresolvedCount: 2 }
            }, epistemic_status: "heuristic") ]
          }
        } ]
      }
    )

    assert_equal %w[decision investigation monitoring], candidates.map { |candidate| candidate[:mode] }
    assert_equal [ { type: "tension", id: "tension:launch" } ], candidates.first[:evidence_refs]
    assert_equal [ { type: "curiosity", id: "curiosity:adoption" } ], candidates.second[:evidence_refs]
    assert_equal [ { type: "signal", id: "signal:setup" } ], candidates.third[:evidence_refs]
  end

  test "does not manufacture urgency from goals and weak generated evidence" do
    candidates = Flyd::EvidenceCandidates.call(
      provider_state: {
        providers: [ {
          source: "flyd-cli",
          fresh: true,
          errors: [],
          data: {
            goals: [ evidence("goal", "goal:ship", { status: "active" }, epistemic_status: "user_confirmed", confidence: 0.9) ],
            tensions: [ evidence("tension", "tension:ship", { blockers: 0, tension: 0.2 }, epistemic_status: "heuristic") ],
            nudges: [ evidence("nudge", "nudge:ship", { text: "Consider shipping" }, epistemic_status: "llm_generated", confidence: 0.45) ]
          }
        } ]
      }
    )

    assert_empty candidates
  end

  private

  def evidence(type, id, content, epistemic_status: "observation", confidence: 0.8)
    {
      id: id,
      type: type,
      source: "test",
      content: content,
      confidence: confidence,
      generatedAt: Time.current.iso8601,
      evidenceRefs: [],
      epistemicStatus: epistemic_status
    }
  end
end
