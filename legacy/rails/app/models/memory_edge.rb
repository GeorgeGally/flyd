class MemoryEdge < ApplicationRecord
  belongs_to :source, polymorphic: true
  belongs_to :target, polymorphic: true

  validates :confidence, numericality: { in: 0.0..1.0 }

  scope :by_confidence, -> { order(confidence: :desc) }

  def cite!
    transaction do
      increment!(:citation_count)
      touch(:last_cited_at)
      update!(confidence: [ confidence + 0.05, 1.0 ].min)
    end
  end

  def decay!
    new_confidence = confidence * 0.95
    update!(confidence: [ new_confidence, 0.1 ].max)
  end
end
