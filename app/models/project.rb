class Project < ApplicationRecord
  has_many :conversations, dependent: :destroy
  has_many :decisions, dependent: :destroy
  has_many :beliefs, dependent: :destroy
  has_many :behaviours, dependent: :destroy
  has_many :builds, dependent: :destroy
  has_many :capture_imports, foreign_key: :project, primary_key: :name, dependent: :nullify

  scope :active, -> { where(archived_at: nil) }
  scope :archived, -> { where.not(archived_at: nil) }
  scope :by_recent_activity, -> {
    left_joins(:conversations)
      .group(:id)
      .order(Arel.sql("MAX(conversations.updated_at) DESC NULLS LAST"))
  }

  validates :name, presence: true, uniqueness: true

  def archived?
    archived_at.present?
  end

  def archive!
    update!(archived_at: Time.current)
  end

  def reactivate!
    update!(archived_at: nil)
  end

  def last_activity_at
    conversations.maximum(:updated_at) || updated_at
  end

  def active_conversation
    conversations.find_by(active: true)
  end
end
