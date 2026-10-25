require "test_helper"

class PurgeExpiredIntentAttachmentsJobTest < ActiveJob::TestCase
  test "purges expired unreferenced media from storage and evidence" do
    attachment = stored_attachment(expires_at: 1.minute.ago, checksum: "expired")
    blob_id = attachment.file.blob.id

    assert_difference("IntentAttachment.count", -1) do
      PurgeExpiredIntentAttachmentsJob.perform_now
    end

    assert_not ActiveStorage::Blob.exists?(blob_id)
  end

  test "retains referenced provenance while purging expired media bytes" do
    attachment = stored_attachment(expires_at: 1.minute.ago, checksum: "protected")
    blob_id = attachment.file.blob.id
    surface = Surface.fallback!
    surface.items.first.update!(source_refs: [{ "type" => "intent_attachment", "id" => attachment.id }])

    assert_no_difference("IntentAttachment.count") do
      PurgeExpiredIntentAttachmentsJob.perform_now
    end

    attachment.reload
    assert_not attachment.file.attached?
    assert_not ActiveStorage::Blob.exists?(blob_id)
    assert attachment.metadata["retained_for_provenance"]
    assert attachment.metadata["storage_purged_at"].present?
  end

  private

  def stored_attachment(expires_at:, checksum:)
    intent = Intent.create!(input_text: "Stored media")
    attachment = intent.intent_attachments.create!(
      modality: "file",
      filename: "evidence.txt",
      content_type: "text/plain",
      byte_size: 8,
      checksum: checksum,
      expires_at: expires_at
    )
    attachment.file.attach(
      io: StringIO.new("evidence"),
      filename: "evidence.txt",
      content_type: "text/plain",
      identify: false
    )
    attachment
  end
end
