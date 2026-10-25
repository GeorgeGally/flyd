require "digest"
require "marcel"
require "stringio"

module Intents
  class IngestAttachments
    MAX_FILES = 5
    MAX_TOTAL_BYTES = 25.megabytes
    ALLOWED_TYPES = (
      IntentAttachment::SAFE_INLINE_TYPES +
      IntentAttachment::TEXT_TYPES +
      %w[application/pdf application/zip application/octet-stream]
    ).freeze

    def self.call(intent:, uploads:)
      new(intent:, uploads:).call
    end

    def initialize(intent:, uploads:)
      @intent = intent
      @uploads = Array(uploads).compact
    end

    def call
      raise ArgumentError, "A maximum of #{MAX_FILES} attachments is allowed" if @uploads.length > MAX_FILES

      total_bytes = 0
      @uploads.map do |upload|
        data = upload.read(IntentAttachment::MAX_BYTES + 1)
        raise ArgumentError, "Attachment exceeds 10 MB" if data.bytesize > IntentAttachment::MAX_BYTES

        total_bytes += data.bytesize
        raise ArgumentError, "Attachments exceed the 25 MB total limit" if total_bytes > MAX_TOTAL_BYTES

        filename = File.basename(upload.original_filename.to_s.presence || "attachment")
        content_type = Marcel::MimeType.for(
          StringIO.new(data),
          name: filename,
          declared_type: upload.content_type.to_s.presence
        ).to_s
        raise ArgumentError, "Unsupported attachment type: #{content_type}" unless allowed_type?(content_type)

        checksum = Digest::SHA256.hexdigest(data)
        existing = @intent.intent_attachments.find_by(checksum: checksum)
        next existing if existing

        attachment = @intent.intent_attachments.create!(
          modality: modality_for(content_type),
          filename: filename,
          content_type: content_type,
          byte_size: data.bytesize,
          checksum: checksum,
          data: nil,
          extracted_text: extract_text(data, content_type),
          expires_at: 90.days.from_now,
          metadata: { "declared_content_type" => upload.content_type.to_s, "storage" => "active_storage" }
        )
        attachment.file.attach(
          io: StringIO.new(data),
          filename: filename,
          content_type: content_type,
          identify: false
        )
        attachment
      ensure
        upload.rewind if upload.respond_to?(:rewind)
      end
    end

    private

    def allowed_type?(content_type)
      ALLOWED_TYPES.include?(content_type) || content_type.start_with?("text/")
    end

    def modality_for(content_type)
      return "image" if content_type.start_with?("image/")
      return "audio" if content_type.start_with?("audio/")

      "file"
    end

    def extract_text(data, content_type)
      return unless IntentAttachment::TEXT_TYPES.include?(content_type) || content_type.start_with?("text/")

      data.dup.force_encoding(Encoding::UTF_8).scrub.truncate(20_000)
    end
  end
end
