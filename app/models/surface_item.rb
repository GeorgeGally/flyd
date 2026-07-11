class SurfaceItem < ApplicationRecord
  KINDS = %w[scene insight decision question conversation artifact build reminder status notification].freeze
  INTENTS = %w[inform ask decide discuss build investigate monitor remind review celebrate].freeze
  RENDERERS = %w[hero_scene card conversation document build image timeline notification].freeze
  DEPTHS = %w[foreground middle background receded].freeze
  STATES = %w[presented focused receded resolved dismissed collapsed].freeze

  belongs_to :surface, inverse_of: :surface_items

  validates :item_key, :title, presence: true
  validates :item_key, uniqueness: { scope: :surface_id }
  validates :kind, inclusion: { in: KINDS }
  validates :intent, inclusion: { in: INTENTS }
  validates :renderer, inclusion: { in: RENDERERS }
  validates :depth, inclusion: { in: DEPTHS }
  validates :state, inclusion: { in: STATES }
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
end
