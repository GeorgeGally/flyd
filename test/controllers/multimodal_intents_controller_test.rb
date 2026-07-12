require "test_helper"

class MultimodalIntentsControllerTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  setup do
    Surface.fallback!
  end

  test "ingests a text attachment as durable expiring intent evidence" do
    upload = Rack::Test::UploadedFile.new(
      StringIO.new("The interface is the intelligence expressed."),
      "text/plain",
      original_filename: "note.txt"
    )

    assert_difference([ "Intent.count", "IntentAttachment.count", "ActiveStorage::Blob.count" ], 1) do
      post intents_path, params: { intent: { text: "", files: [ upload ] } }
    end

    intent = Intent.order(:created_at).last
    attachment = intent.intent_attachments.first
    assert_equal "file", intent.modality
    assert_equal "The interface is the intelligence expressed.", attachment.extracted_text
    assert_equal "note.txt", attachment.filename
    assert attachment.expires_at > 89.days.from_now
    assert attachment.file.attached?
    assert_nil attachment.data
    assert_equal "The interface is the intelligence expressed.", attachment.file.download
  end

  test "ingests clipboard content with the same retention boundary" do
    post intents_path, params: { intent: { clipboard: "A thought spanning the whole system" } }

    intent = Intent.order(:created_at).last
    attachment = intent.intent_attachments.first
    assert_equal "clipboard", intent.modality
    assert_equal "A thought spanning the whole system", attachment.extracted_text
    assert attachment.expires_at > 89.days.from_now
    assert_not attachment.file.attached?
    assert_not Project.exists?(name: "Inbox")
  end

  test "rejects unsafe inline media even when the declared type is safe" do
    upload = Rack::Test::UploadedFile.new(
      StringIO.new('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      "image/png",
      original_filename: "unsafe.svg"
    )

    assert_no_difference([ "Intent.count", "IntentAttachment.count", "ActiveStorage::Blob.count" ]) do
      post intents_path, params: { intent: { files: [ upload ] } }
    end

    assert_redirected_to root_path
    assert_equal "Unsupported attachment type: image/svg+xml", flash[:alert]
  end

  test "deduplicates identical attachments within one intent" do
    first = Rack::Test::UploadedFile.new(StringIO.new("same"), "text/plain", original_filename: "one.txt")
    second = Rack::Test::UploadedFile.new(StringIO.new("same"), "text/plain", original_filename: "two.txt")

    assert_difference("Intent.count", 1) do
      assert_difference([ "IntentAttachment.count", "ActiveStorage::Blob.count" ], 1) do
        post intents_path, params: { intent: { files: [ first, second ] } }
      end
    end
  end
end
