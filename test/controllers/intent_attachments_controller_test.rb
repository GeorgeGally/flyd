require "test_helper"

class IntentAttachmentsControllerTest < ActionDispatch::IntegrationTest
  test "serves stored safe media inline with private headers" do
    intent = Intent.create!(input_text: "Image evidence")
    attachment = intent.intent_attachments.create!(
      modality: "image",
      filename: "pixel.png",
      content_type: "image/png",
      byte_size: 8,
      checksum: "pixel",
      expires_at: 1.day.from_now
    )
    attachment.file.attach(
      io: StringIO.new("PNG DATA"),
      filename: "pixel.png",
      content_type: "image/png",
      identify: false
    )

    get intent_attachment_path(attachment)

    assert_response :success
    assert_equal "image/png", response.media_type
    assert_match(/inline/, response.headers["Content-Disposition"])
    assert_equal "private, no-store", response.headers["Cache-Control"]
    assert_equal "PNG DATA", response.body
  end

  test "forces unsafe legacy content to download" do
    intent = Intent.create!(input_text: "File evidence")
    attachment = intent.intent_attachments.create!(
      modality: "file",
      filename: "document.pdf",
      content_type: "application/pdf",
      byte_size: 3,
      checksum: "pdf",
      data: "PDF",
      expires_at: 1.day.from_now
    )

    get intent_attachment_path(attachment)

    assert_response :success
    assert_match(/attachment/, response.headers["Content-Disposition"])
    assert_equal "PDF", response.body
  end

  test "does not serve expired evidence" do
    intent = Intent.create!(input_text: "Expired evidence")
    attachment = intent.intent_attachments.create!(
      modality: "file",
      filename: "old.txt",
      content_type: "text/plain",
      byte_size: 3,
      checksum: "old",
      extracted_text: "old",
      expires_at: 1.minute.ago
    )

    get intent_attachment_path(attachment)

    assert_response :not_found
  end
end
