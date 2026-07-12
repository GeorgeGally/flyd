class SurfaceItem < ApplicationRecord
  KINDS = %w[scene insight decision question conversation artifact reminder status notification].freeze
  INTENTS = %w[inform ask decide discuss investigate monitor remind review celebrate build].freeze
  RENDERERS = %w[hero_scene supporting_card conversation document notification code data_table media].freeze
  DEPTHS = %w[foreground middle background receded].freeze
  STATES = %w[presented focused receded resolved dismissed collapsed].freeze

  belongs_to :surface, inverse_of: :surface_items
  belongs_to :scene, optional: true
  has_many :context_corrections, dependent: :destroy
  has_many :surface_feedbacks, dependent: :destroy

  validates :item_key, :title, presence: true
  validates :item_key, uniqueness: { scope: :surface_id }
  validates :kind, inclusion: { in: KINDS }
  validates :intent, inclusion: { in: INTENTS }
  validates :renderer, inclusion: { in: RENDERERS }
  validates :depth, inclusion: { in: DEPTHS }
  validates :state, inclusion: { in: STATES }
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
end
