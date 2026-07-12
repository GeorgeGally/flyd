class Artifact < ApplicationRecord
  KINDS = %w[resolution build_result build_failure decision plan document code report].freeze
  STATUSES = %w[draft ready failed superseded].freeze

  belongs_to :scene
  belongs_to :project, optional: true
  belongs_to :context, optional: true
  belongs_to :conversation, optional: true
  belongs_to :build, optional: true

  validates :kind, inclusion: { in: KINDS }
  validates :status, inclusion: { in: STATUSES }
  validates :title, presence: true

  scope :recent, -> { order(created_at: :desc) }
end
