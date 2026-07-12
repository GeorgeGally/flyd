class Surface < ApplicationRecord
  STATUSES = %w[draft active superseded invalid expired].freeze
  DEFAULT_VALIDITY = 30.minutes

  belongs_to :previous_surface, class_name: "Surface", optional: true
  has_many :next_surfaces, class_name: "Surface", foreign_key: :previous_surface_id, dependent: :nullify, inverse_of: :previous_surface
  has_many :surface_items, -> { order(:position, :id) }, dependent: :destroy, inverse_of: :surface
  has_many :surface_feedbacks, dependent: :destroy
  has_many :surface_composition_logs, dependent: :nullify
  has_many :originating_intents, class_name: "Intent", foreign_key: :origin_surface_id, dependent: :nullify, inverse_of: :origin_surface
  has_many :resulting_intents, class_name: "Intent", foreign_key: :result_surface_id, dependent: :nullify, inverse_of: :result_surface

  validates :status, inclusion: { in: STATUSES }
  validates :composition_version, presence: true

  scope :active, -> { where(status: "active") }
  scope :newest_first, -> { order(generated_at: :desc, created_at: :desc) }

  class << self
    def current
      active.includes(surface_items: :scene).newest_first.first
    end

    def fallback!
      current || transaction do
        lock.where(status: "active").first || create_fallback!
      end
    rescue ActiveRecord::RecordNotUnique
      current!
    end

    def activate!(surface)
      transaction do
        surface.lock!
        raise ActiveRecord::RecordInvalid, surface unless surface.valid?
        raise ArgumentError, "Only draft surfaces can be activated" unless surface.status == "draft"
        raise ArgumentError, "Surface must contain at least one item" if surface.surface_items.empty?
        if surface.focus_item_key.present? && !surface.surface_items.exists?(item_key: surface.focus_item_key)
          raise ArgumentError, "Focus item must belong to the surface"
        end

        previous = lock.where(status: "active").first
        previous&.update!(status: "superseded")

        surface.update!(
          status: "active",
          previous_surface: previous,
          generated_at: surface.generated_at || Time.current,
          valid_until: surface.valid_until || DEFAULT_VALIDITY.from_now
        )

        surface
      end
    end

    private

    def current!
      current || raise(ActiveRecord::RecordNotFound, "Active surface was not created")
    end

    def create_fallback!
      scene = Scene.find_or_create_by!(scene_key: "continue") do |record|
        record.kind = "work"
        record.status = "active"
        record.title = "What deserves your attention?"
        record.summary = "Tell Flyd what is happening. The surface will reorganize around the context."
      end
      scene.update!(last_presented_at: Time.current)

      surface = create!(
        status: "draft",
        understanding: "Flyd is ready but has not prepared a contextual surface yet.",
        current_intention: "Remain available without fabricating relevance.",
        focus_item_key: "continue",
        generated_at: Time.current,
        valid_until: DEFAULT_VALIDITY.from_now,
        composition_version: "fallback-2",
        metadata: { "fallback" => true, "surface_mode" => "idle" }
      )

      surface.surface_items.create!(
        scene: scene,
        item_key: "continue",
        kind: "scene",
        intent: "discuss",
        renderer: "hero_scene",
        depth: "foreground",
        state: "presented",
        title: scene.title,
        summary: scene.summary,
        position: 0
      )

      activate!(surface)
    end
  end

  def items
    surface_items
  end

  def focus_item_id
    focus_item_key
  end

  def stale?
    valid_until.blank? || valid_until <= Time.current
  end

  def active?
    status == "active"
  end

  def invalidate!(reason: nil)
    update!(status: "invalid", metadata: metadata.merge("invalid_reason" => reason).compact)
  end

  def expire!
    update!(status: "expired", valid_until: [ valid_until, Time.current ].compact.min)
  end
end
