class Build < ApplicationRecord
  STATUSES = %w[proposed pending preparing running complete failed].freeze

  belongs_to :project
  belongs_to :conversation
  belongs_to :scene, optional: true
  belongs_to :artifact, optional: true
  belongs_to :requested_by_surface_item, class_name: "SurfaceItem", optional: true

  validates :status, inclusion: { in: STATUSES }
  validates :instructions, presence: true, if: :proposed?

  scope :recent, -> { order(created_at: :desc).limit(5) }

  def proposed?
    status == "proposed"
  end

  def running?
    %w[pending preparing running].include?(status)
  end

  def confirm!
    raise ArgumentError, "Only proposed builds can be confirmed" unless proposed?

    update!(status: "pending", confirmed_at: Time.current)
  end

  def revert_confirmation!
    return false unless status == "pending"

    update!(status: "proposed", confirmed_at: nil)
  end

  def start!
    update!(status: "preparing", started_at: Time.current)
  end

  def complete!(output: nil, summary: nil, artifact: nil)
    return false unless running?

    update!(
      status: "complete",
      output: output,
      outcome_summary: summary,
      artifact: artifact,
      completed_at: Time.current
    )
  end

  def fail!(reason: nil, artifact: nil)
    return false unless running?

    update!(
      status: "failed",
      outcome_summary: reason,
      artifact: artifact,
      completed_at: Time.current
    )
  end
end
