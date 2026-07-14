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

  test "derives a rotating discovery from grounded personal evidence" do
    shown = evidence("report", "report:shown", { title: "Already shown", excerpt: "Old connection" })
    fresh = evidence("report", "report:memex", {
      title: "The memex and associative trails",
      excerpt: "Vannevar Bush described linked personal knowledge in 1945."
    })

    candidates = Flyd::EvidenceCandidates.call(
      previous_surface: {
        items: [ { source_refs: [ { type: "report", id: "report:shown" } ] } ]
      },
      provider_state: {
        providers: [ {
          source: "flyd-cli",
          fresh: true,
          data: { reports: [ shown, fresh ] }
        } ]
      }
    )

    discovery = candidates.find { |candidate| candidate[:mode] == "discovery" }
    assert_equal [ { type: "report", id: "report:memex" } ], discovery[:evidence_refs]
    assert_match(/grounded/i, discovery[:reason])
  end

  test "does not turn ungrounded generated material into discovery" do
    candidates = Flyd::EvidenceCandidates.call(
      provider_state: {
        providers: [ {
          data: {
            reports: [ evidence(
              "report",
              "report:generated",
              { title: "A guess", excerpt: "Maybe this matters" },
              epistemic_status: "llm_generated",
              confidence: 0.9
            ) ]
          }
        } ]
      }
    )

    assert_empty candidates
  end

  test "reads serialized provider content with string keys" do
    candidates = Flyd::EvidenceCandidates.call(
      "provider_state" => {
        "providers" => [ {
          "data" => {
            "recent_events" => [ {
              "id" => "event:serialized",
              "type" => "event",
              "epistemic_status" => "observation",
              "confidence" => 0.8,
              "generated_at" => 30.days.ago.iso8601,
              "content" => {
                "excerpt" => "A stored observation with enough substance to become a useful rediscovery.",
                "date" => 30.days.ago.iso8601
              }
            } ]
          }
        } ]
      }
    )

    assert_equal "discovery", candidates.first[:mode]
    assert_equal "event:serialized", candidates.first.dig(:evidence_refs, 0, :id)
  end

  test "rejects test pollution and prefers substantive archive discoveries" do
    candidates = Flyd::EvidenceCandidates.call(
      provider_state: {
        providers: [ {
          data: {
            recent_events: [ evidence(
              "event",
              "event:test",
              { excerpt: "test: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", date: 2.days.ago.iso8601 }
            ) ],
            reports: [
              evidence("report", "report:status", { title: "Attention Report", excerpt: "A generated operational status table." }),
              evidence("report", "report:research", { title: "Research Before Planning", excerpt: "Current community evidence should ground decisions before implementation begins." })
            ]
          }
        } ]
      }
    )

    assert_equal "report:research", candidates.first.dig(:evidence_refs, 0, :id)
  end

  test "does not present stale web news as current discovery" do
    candidates = Flyd::EvidenceCandidates.call(
      provider_state: {
        providers: [ {
          source: "web-discovery",
          fresh: false,
          data: {
            discoveries: [ evidence(
              "discovery",
              "discovery:hn:old",
              { title: "Old story", excerpt: "This story is no longer current." }
            ) ]
          }
        } ]
      }
    )

    assert_empty candidates
  end

  test "does not give the stage to a current headline without meaningful article content" do
    candidates = Flyd::EvidenceCandidates.call(
      provider_state: {
        providers: [ {
          source: "web-discovery",
          fresh: true,
          data: {
            discoveries: [
              evidence("discovery", "discovery:hn:thin", { title: "A thin headline", description: "describe" }),
              evidence("discovery", "discovery:hn:grounded", {
                title: "A grounded current story",
                description: "Scientists recovered up to 90% of lithium from used electric vehicle batteries."
              })
            ]
          }
        } ]
      }
    )

    assert_equal "discovery:hn:grounded", candidates.first.dig(:evidence_refs, 0, :id)
  end

  test "builds a three-object discovery led by recent personal context" do
    candidates = Flyd::EvidenceCandidates.call(
      provider_state: {
        providers: [
          {
            source: "personal-context",
            fresh: true,
            data: {
              activities: [
                evidence("activity", "activity:flyd", {
                  title: "Continue Flyd",
                  description: "Build the living discovery stage.",
                  updatedAt: 1.hour.ago.iso8601
                }, confidence: 0.95),
                evidence("activity", "activity:other", {
                  title: "Continue another project",
                  description: "A second recent project must not displace current news.",
                  updatedAt: 2.hours.ago.iso8601
                }, confidence: 0.95)
              ],
              horoscopes: [ evidence("horoscope", "horoscope:aries:today", {
                title: "Aries",
                description: "Make room for a creative risk today.",
                date: Date.current.iso8601
              }, confidence: 0.9) ]
            }
          },
          {
            source: "web-discovery",
            fresh: true,
            data: {
              discoveries: [ evidence("discovery", "discovery:feed:1", {
                title: "A current creative coding story",
                description: "A detailed account of a new creative coding instrument and how it was made."
              }) ]
            }
          }
        ]
      }
    )

    discovery = candidates.find { |candidate| candidate[:mode] == "discovery" }
    assert_equal %w[activity:flyd horoscope:aries:today discovery:feed:1], discovery[:evidence_refs].pluck(:id)
  end

  test "keeps personal anchors while rotating previously shown discoveries" do
    activity = evidence("activity", "activity:flyd", {
      title: "Continue Flyd", description: "Build the living discovery stage.", updatedAt: 1.hour.ago.iso8601
    }, confidence: 0.95)
    horoscope = evidence("horoscope", "horoscope:aries:today", {
      title: "Aries", description: "Make room for a creative risk today.", date: Date.current.iso8601
    }, confidence: 0.9)
    shown_story = evidence("discovery", "discovery:feed:shown", {
      title: "Already shown", description: "This current story already occupied the living stage once today."
    })
    fresh_story = evidence("discovery", "discovery:feed:fresh", {
      title: "A fresh current story", description: "This current story has not yet occupied the living stage today."
    })

    candidates = Flyd::EvidenceCandidates.call(
      previous_surface: {
        items: [ activity, horoscope, shown_story ].map do |item|
          { source_refs: [ { type: item[:type], id: item[:id] } ] }
        end
      },
      provider_state: {
        providers: [ {
          source: "personal-context",
          fresh: true,
          data: { activities: [ activity ], horoscopes: [ horoscope ] }
        }, {
          source: "web-discovery",
          fresh: true,
          data: { discoveries: [ shown_story, fresh_story ] }
        } ]
      }
    )

    discovery = candidates.find { |candidate| candidate[:mode] == "discovery" }
    assert_equal %w[activity:flyd horoscope:aries:today discovery:feed:fresh], discovery[:evidence_refs].pluck(:id)
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
