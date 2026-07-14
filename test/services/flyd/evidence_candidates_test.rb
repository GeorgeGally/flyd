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
            }, epistemic_status: "llm_generated", confidence: 0.7, evidence_refs: [ { type: "event", id: "event:setup" } ]) ],
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

  test "rejects stale ungrounded generated curiosity and stale unresolved signals" do
    stale_time = 30.days.ago.iso8601
    candidates = Flyd::EvidenceCandidates.call(
      provider_state: {
        providers: [ {
          source: "flyd-cli",
          fresh: true,
          errors: [],
          data: {
            curiosity: [ evidence(
              "curiosity",
              "curiosity:generic",
              { question: "What is declining?", missingEvidence: "Real evidence" },
              epistemic_status: "llm_generated",
              confidence: 0.5,
              generated_at: stale_time
            ) ],
            signals: [ evidence(
              "signal",
              "signal:old",
              { topic: "content quality", unresolved: 1, details: { lastActivity: stale_time } },
              epistemic_status: "heuristic",
              confidence: 0.55,
              generated_at: nil
            ) ]
          }
        } ]
      }
    )

    assert_empty candidates
  end

  test "honours normalized epistemic status keys" do
    candidates = Flyd::EvidenceCandidates.call(
      provider_state: {
        providers: [ {
          data: {
            curiosity: [ {
              id: "curiosity:rejected",
              type: "curiosity",
              epistemic_status: "superseded",
              confidence: 0.9,
              generated_at: Time.current.iso8601,
              evidence_refs: [ { type: "event", id: "event:1" } ],
              content: { question: "Why?", missing_evidence: "Evidence" }
            } ]
          }
        } ]
      }
    )

    assert_empty candidates
  end

  private

  def evidence(type, id, content, epistemic_status: "observation", confidence: 0.8, generated_at: Time.current.iso8601, evidence_refs: [])
    {
      id: id,
      type: type,
      source: "test",
      content: content,
      confidence: confidence,
      generatedAt: generated_at,
      evidenceRefs: evidence_refs,
      epistemicStatus: epistemic_status
    }
  end
end
