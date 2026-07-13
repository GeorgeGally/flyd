class SurfaceItemSourcesController < ApplicationController
  def show
    @item = SurfaceItem.find(params[:surface_item_id])
    @surface = @item.surface
    @sources = resolve_sources(@item.source_refs)
  end

  private

  def resolve_sources(references)
    Array(references).map do |reference|
      type = reference["type"] || reference[:type]
      id = reference["id"] || reference[:id]
      {
        type: type,
        id: id,
        record: resolve_record(type, id)
      }
    end
  end

  def resolve_record(type, id)
    case type
    when "project" then Project.find_by(id: id)
    when "context" then Context.find_by(id: id)
    when "decision" then Decision.find_by(id: id)
    when "belief" then Belief.find_by(id: id)
    when "message" then Message.find_by(id: id)
    when "conversation" then Conversation.find_by(id: id)
    when "intent" then Intent.find_by(id: id)
    when "intent_attachment" then IntentAttachment.find_by(id: id)
    else
      snapshot_source(type, id)
    end
  end

  def snapshot_source(type, id)
    provider = Array(@surface.metadata["provider_snapshots"]).find do |entry|
      entry["source"] == IntelligenceState::CliProvider::PROVIDER
    end
    snapshot = IntelligenceSnapshot.find_by(id: provider && provider["snapshot_id"])
    return unless snapshot

    snapshot.payload.values.grep(Array).flatten.find do |item|
      item.is_a?(Hash) && item["type"] == type && item["id"].to_s == id.to_s
    end
  end
end
