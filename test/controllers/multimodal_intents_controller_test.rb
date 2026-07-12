require "test_helper"

class MultimodalIntentsControllerTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  setup do
    Surface.fallback!
  end

  test "ingests a text attachment as durable intent evidence" do
    upload = Rack::Test::UploadedFile.new(
      StringIO.new("The interface is the intelligence expressed."),
      "text/plain",
      original_filename: "note.txt"
    )

    assert_difference([ "Intent.count", "IntentAttachment.count" ], 1) do
      post intents_path, params: { intent: { text: "", files: [ upload ] } }
    end

    intent = Intent.order(:created_at).last
    attachment = intent.intent_attachments.first
    assert_equal "file", intent.modality
    assert_equal "The interface is the intelligence expressed.", attachment.extracted_text
    assert_equal "note.txt", attachment.filename
  end

  test "ingests clipboard content without creating a project" do
    post intents_path, params: { intent: { clipboard: "A thought spanning the whole system" } }

    intent = Intent.order(:created_at).last
    assert_equal "clipboard", intent.modality
    assert_equal "A thought spanning the whole system", intent.intent_attachments.first.extracted_text
    assert_not Project.exists?(name: "Inbox")
  end
end
