class PurgeExpiredIntentAttachmentsJob < ApplicationJob
  queue_as :default

  def perform
    protected_ids = SurfaceItem.pluck(:source_refs).flatten.filter_map do |reference|
      type = reference["type"] || reference[:type]
      id = reference["id"] || reference[:id]
      id if type == "intent_attachment"
    end.map(&:to_i).uniq

    IntentAttachment.expired.find_each do |attachment|
      attachment.purge_storage!
      if protected_ids.include?(attachment.id)
        attachment.update!(
          data: nil,
          metadata: attachment.metadata.merge(
            "storage_purged_at" => Time.current.iso8601,
            "retained_for_provenance" => true
          )
        )
      else
        attachment.destroy!
      end
    end
  end
end
