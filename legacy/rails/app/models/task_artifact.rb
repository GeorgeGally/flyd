class TaskArtifact < ApplicationRecord
  KINDS = %w[diff test log code image document].freeze
  VERIFICATION_STATUSES = %w[pending verified rejected].freeze
  INLINE_IMAGE_TYPES = %w[image/png image/jpeg image/gif image/webp].freeze

  belongs_to :agent_task
  belongs_to :task_assignment, optional: true
  belongs_to :worker_session, optional: true

  before_validation :assign_artifact_key, on: :create

  validates :artifact_key, :kind, :title, :media_type, :sha256_digest, presence: true
  validates :artifact_key, uniqueness: true
  validates :kind, inclusion: { in: KINDS }
  validates :verification_status, inclusion: { in: VERIFICATION_STATUSES }
  validates :byte_size, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :source_revision, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :sha256_digest, format: { with: /\A\h{64}\z/ }
  validates :content, length: { maximum: 300.kilobytes }, allow_nil: true
  validate :owner_records_belong_to_task
  validate :relative_path_is_safe

  scope :verified, -> { where(verification_status: "verified") }
  scope :recent, -> { order(created_at: :desc) }

  def inline_image?
    verified? && kind == "image" && INLINE_IMAGE_TYPES.include?(media_type)
  end

  def verified?
    verification_status == "verified"
  end

  def readonly?
    persisted?
  end

  private

  def assign_artifact_key
    self.artifact_key ||= SecureRandom.uuid
  end

  def owner_records_belong_to_task
    if task_assignment && task_assignment.agent_task_id != agent_task_id
      errors.add(:task_assignment, "must belong to the same task")
    end
    if worker_session && worker_session.agent_task_id != agent_task_id
      errors.add(:worker_session, "must belong to the same task")
    end
  end

  def relative_path_is_safe
    return if relative_path.blank?

    path = Pathname(relative_path)
    errors.add(:relative_path, "must be repository-relative") if path.absolute? || path.each_filename.include?("..")
  end
end
