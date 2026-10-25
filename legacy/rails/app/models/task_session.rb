class TaskSession < ApplicationRecord
  INTERPRETATIONS = %w[pending accepted focused_corrected replaced].freeze

  belongs_to :agent_task
  has_many :task_recommendations, dependent: :destroy

  before_validation :assign_session_key, on: :create

  validates :session_key, presence: true, uniqueness: true
  validates :status, inclusion: { in: %w[active ended] }
  validates :interpretation_status, inclusion: { in: INTERPRETATIONS }

  def readonly?
    persisted?
  end

  private

  def assign_session_key
    self.session_key ||= SecureRandom.uuid
  end
end
