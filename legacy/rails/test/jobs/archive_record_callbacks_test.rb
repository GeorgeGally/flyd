require "test_helper"

class ArchiveRecordCallbacksTest < ActiveJob::TestCase
  test "exports extracted decisions after commit" do
    project = Project.create!(name: "Flyd")
    conversation = Conversation.start!(project)

    assert_enqueued_with(job: ArchiveEventJob) do
      project.decisions.create!(conversation: conversation, content: "Use one shared brain", confidence: 0.9)
    end

    attributes = enqueued_jobs.find { |job| job[:job] == ArchiveEventJob }[:args].first
    assert_equal "decision", attributes["event_type"]
    assert_equal "Use one shared brain", attributes["body"]
  end

  test "exports context corrections after commit" do
    intent = Intent.create!(input_text: "This belongs to Flyd")

    assert_enqueued_with(job: ArchiveEventJob) do
      ContextCorrection.create!(
        intent: intent,
        original_contexts: [],
        corrected_contexts: [{ "type" => "project", "id" => 8, "name" => "Flyd" }],
        reason: "Corrected to Flyd"
      )
    end

    attributes = enqueued_jobs.find { |job| job[:job] == ArchiveEventJob }[:args].first
    assert_equal "context_correction", attributes["event_type"]
    assert_match(/Corrected to Flyd/, attributes["body"])
    assert_match(/Flyd/, attributes["body"])
  end
end
