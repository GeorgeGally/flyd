require "uri"

class SurfaceSourceResolver
  ResolvedSource = Data.define(:type, :id, :record, :url, :discussion_url)

  LOCAL_MODELS = {
    "project" => Project,
    "context" => Context,
    "decision" => Decision,
    "belief" => Belief,
    "message" => Message,
    "conversation" => Conversation,
    "intent" => Intent,
    "intent_attachment" => IntentAttachment,
    "artifact" => Artifact,
    "scene" => Scene,
    "build" => Build
  }.freeze

  def initialize(surface)
    @surface = surface
  end

  def call(references)
    Array(references).map { |reference| resolve(reference) }
  end

  def resolve(reference)
    reference = reference.to_h.deep_symbolize_keys
    type = reference[:type].to_s
    id = reference[:id]
    record = local_record(type, id) || snapshot_record(type, id)
    content = record.is_a?(Hash) ? record["content"].to_h : {}

    ResolvedSource.new(
      type: type,
      id: id,
      record: record,
      url: safe_url(content["url"]),
      discussion_url: safe_url(content["discussionUrl"] || content["discussion_url"])
    )
  end

  private

  def local_record(type, id)
    LOCAL_MODELS[type]&.find_by(id: id)
  end

  def snapshot_record(type, id)
    provider_snapshots.each do |entry|
      snapshot = IntelligenceSnapshot.find_by(id: entry[:snapshot_id], provider: entry[:source])
      next unless snapshot

      found = snapshot.payload.values.grep(Array).flatten.find do |item|
        item.is_a?(Hash) && item["type"].to_s == type && item["id"].to_s == id.to_s
      end
      return found if found
    end
    nil
  end

  def provider_snapshots
    Array(@surface.metadata["provider_snapshots"]).map { |entry| entry.to_h.deep_symbolize_keys }
  end

  def safe_url(value)
    uri = URI.parse(value.to_s)
    uri.to_s if uri.scheme.in?(%w[http https]) && uri.host.present?
  rescue URI::InvalidURIError
    nil
  end
end
