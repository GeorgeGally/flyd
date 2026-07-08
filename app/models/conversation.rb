class Conversation < ApplicationRecord
  belongs_to :project
  has_many :messages, dependent: :destroy
  has_many :decisions, dependent: :destroy

  scope :active_for, ->(project) { where(project: project, active: true) }
  scope :ordered, -> { order(updated_at: :desc) }

  validates :status, inclusion: { in: %w[active archived] }

  def self.start!(project, summary: nil)
    transaction do
      active_for(project).update_all(active: false)
      create!(project: project, active: true, status: "active", summary: summary)
    end
  end

  def archive!
    update!(active: false, status: "archived")
  end
end
