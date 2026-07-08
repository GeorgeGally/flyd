class Build < ApplicationRecord
  belongs_to :project
  belongs_to :conversation

  validates :status, inclusion: { in: %w[pending preparing running complete failed] }

  scope :recent, -> { order(created_at: :desc).limit(5) }

  def running?
    %w[pending preparing running].include?(status)
  end

  def start!
    update!(status: "preparing", started_at: Time.current)
  end

  def complete!(output: nil, summary: nil)
    return false unless running?
    update!(
      status: "complete",
      output: output,
      outcome_summary: summary,
      completed_at: Time.current
    )
  end

  def fail!(reason: nil)
    return false unless running?
    update!(
      status: "failed",
      outcome_summary: reason,
      completed_at: Time.current
    )
  end
end
