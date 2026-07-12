class Conversation < ApplicationRecord
  belongs_to :project, optional: true
  belongs_to :context, optional: true
  belongs_to :superseded_by_conversation, class_name: "Conversation", optional: true
  has_many :superseded_conversations, class_name: "Conversation", foreign_key: :superseded_by_conversation_id, dependent: :nullify, inverse_of: :superseded_by_conversation
  has_many :messages, dependent: :destroy
  has_many :decisions, dependent: :destroy

  scope :active_for, ->(owner) do
    case owner
    when Project then where(project: owner, context: nil, active: true)
    when Context then where(context: owner, project: nil, active: true)
    else none
    end
  end
  scope :ordered, -> { order(updated_at: :desc) }

  validates :status, inclusion: { in: %w[active archived superseded] }
  validate :has_exactly_one_context_owner

  def self.start!(owner, summary: nil)
    transaction do
      active_for(owner).update_all(active: false)
      attributes = { active: true, status: "active", summary: summary }
      attributes[owner.is_a?(Project) ? :project : :context] = owner
      create!(attributes)
    end
  end

  def owner
    project || context
  end

  def owner_name
    owner&.name || "Global"
  end

  def supersede_by!(replacement)
    update!(active: false, status: "superseded", superseded_by_conversation: replacement)
  end

  def archive!
    update!(active: false, status: "archived")
  end

  private

  def has_exactly_one_context_owner
    return if project.present? ^ context.present?

    errors.add(:base, "Conversation must belong to exactly one project or context")
  end
end
