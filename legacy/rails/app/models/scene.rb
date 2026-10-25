class Scene < ApplicationRecord
  KINDS = %w[work question decision investigation build monitoring conversation].freeze
  STATUSES = %w[active resolved dismissed superseded].freeze

  belongs_to :project, optional: true
  belongs_to :context, optional: true
  belongs_to :conversation, optional: true
  belongs_to :intent, optional: true
  belongs_to :resolved_artifact, class_name: "Artifact", optional: true

  has_many :surface_items, dependent: :nullify
  has_many :artifacts, dependent: :destroy
  has_many :builds, dependent: :nullify

  validates :scene_key, :title, presence: true
  validates :scene_key, uniqueness: true
  validates :kind, inclusion: { in: KINDS }
  validates :status, inclusion: { in: STATUSES }
  validate :valid_expiry_metadata

  scope :active, -> { where(status: "active") }
  scope :continuable, -> { active.where.not(conversation_id: nil).order(updated_at: :desc) }
  scope :recent, -> { order(updated_at: :desc) }

  def self.continue_scene
    continuable.includes(:conversation).first || active.recent.first
  end

  def present!(title:, summary:, kind: nil, conversation: nil, intent: nil, project: nil, context: nil)
    update!(
      title: title,
      summary: summary,
      kind: normalized_kind(kind),
      conversation: conversation || self.conversation,
      intent: intent || self.intent,
      project: project || self.project,
      context: context || self.context,
      last_presented_at: Time.current,
      status: status == "dismissed" ? status : "active"
    )
  end

  def resolve!(artifact:, summary: nil)
    update!(
      status: "resolved",
      resolved_artifact: artifact,
      resolution_summary: summary.presence || artifact.content.to_s.truncate(1_000),
      resolved_at: Time.current
    )
  end

  def dismiss!
    update!(status: "dismissed")
  end

  private

  def valid_expiry_metadata
    value = metadata.to_h["expires_at"]
    return if value.blank?

    Time.iso8601(value.to_s)
  rescue ArgumentError
    errors.add(:metadata, "expires_at must be an ISO8601 timestamp")
  end

  def normalized_kind(candidate)
    value = candidate.to_s
    KINDS.include?(value) ? value : kind
  end
end
