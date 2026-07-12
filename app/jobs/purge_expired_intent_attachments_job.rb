class PurgeExpiredIntentAttachmentsJob < ApplicationJob
  queue_as :default

  def perform
    protected_ids = SurfaceItem.pluck(:source_refs).flatten.filter_map do |reference|
      type = reference["type"] || reference[:type]
      id = reference["id"] || reference[:id]
      id if type == "intent_attachment"
    end.map(&:to_i).uniq

    IntentAttachment.expired.where.not(id: protected_ids).find_each(&:destroy!)
  end
end
