require "digest"

module Intents
  class IngestAttachments
    MAX_FILES = 5

    def self.call(intent:, uploads:)
      new(intent:, uploads:).call
    end

    def initialize(intent:, uploads:)
      @intent = intent
      @uploads = Array(uploads).compact.first(MAX_FILES)
    end

    def call
      @uploads.map do |upload|
        data = upload.read(IntentAttachment::MAX_BYTES + 1)
        raise ArgumentError, "Attachment exceeds 10 MB" if data.bytesize > IntentAttachment::MAX_BYTES

        content_type = upload.content_type.to_s.presence || "application/octet-stream"
        modality = modality_for(content_type)
        @intent.intent_attachments.create!(
          modality: modality,
          filename: upload.original_filename.to_s,
          content_type: content_type,
          byte_size: data.bytesize,
          checksum: Digest::SHA256.hexdigest(data),
          data: data,
          extracted_text: extract_text(data, content_type),
          metadata: {}
        )
      ensure
        upload.rewind if upload.respond_to?(:rewind)
      end
    end

    private

    def modality_for(content_type)
      return "image" if content_type.start_with?("image/")
      return "audio" if content_type.start_with?("audio/")

      "file"
    end

    def extract_text(data, content_type)
      return unless content_type.start_with?("text/") || content_type.in?(%w[application/json application/xml])

      data.force_encoding(Encoding::UTF_8).scrub.truncate(20_000)
    end
  end
end
