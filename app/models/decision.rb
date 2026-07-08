class Decision < ApplicationRecord
  include Decayable

  belongs_to :conversation
  belongs_to :project
  belongs_to :source_message, class_name: "Message", optional: true
  has_many :memory_edges_as_source, class_name: "MemoryEdge", as: :source, dependent: :destroy
  has_many :memory_edges_as_target, class_name: "MemoryEdge", as: :target, dependent: :destroy

  validates :content, presence: true
  validates :conversation, :project, presence: true

  before_validation :sync_project_from_conversation, on: :create

  scope :recent, -> { order(created_at: :desc).limit(10) }
  scope :by_recency, -> { order(created_at: :desc) }

  def decay_type
    :project_decision
  end

  private

  def sync_project_from_conversation
    self.project ||= conversation&.project
  end
end
