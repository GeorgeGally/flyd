require "test_helper"

class DecisionExtractionJobTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  setup do
    @project = Project.create!(name: "Decision extraction")
    @conversation = Conversation.start!(@project)
    @source_message = @conversation.messages.create!(role: "user", content: "Use PostgreSQL")
  end

  test "extracts project decisions and scopes belief synthesis to newly created records" do
    existing = @project.decisions.create!(
      conversation: @conversation,
      source_message: @source_message,
      content: "Keep existing infrastructure",
      extracted_at: Time.current
    )
    engine = Object.new
    engine.define_singleton_method(:extract_decisions) do |conversation|
      conversation.project.decisions.create!(
        conversation: conversation,
        source_message: conversation.messages.last,
        content: "Use PostgreSQL",
        extracted_at: Time.current
      )
    end
    compose_calls = []

    Subsystems::MemoryEngine.stub(:new, engine) do
      ComposeSurfaceJob.stub(:enqueue, ->(**arguments) { compose_calls << arguments }) do
        assert_enqueued_with(job: BeliefSynthesisJob) do
          DecisionExtractionJob.perform_now(@conversation.id)
        end
      end
    end

    new_decision = @project.decisions.where.not(id: existing.id).sole
    belief_job = enqueued_jobs.find { |job| job[:job] == BeliefSynthesisJob }
    assert_equal @project.id, belief_job[:args].first
    assert_equal [new_decision.id], belief_job[:args].second.fetch("decision_ids")
    assert_equal [{ reason: "memory_update", active_conversation_id: @conversation.id }], compose_calls
  end

  test "does nothing for a conversation without a project" do
    context = Context.create!(name: "Temporary", kind: "temporary")
    conversation = Conversation.start!(context)

    Subsystems::MemoryEngine.stub(:new, ->(*) { flunk "temporary context must not initialize project memory" }) do
      assert_no_enqueued_jobs do
        DecisionExtractionJob.perform_now(conversation.id)
      end
    end
  end
end
