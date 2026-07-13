module Surfaces
  class LearnFromFeedback
    POSITIVE = %w[opened discussed resolved corrected useful].freeze
    NEGATIVE = %w[ignored dismissed not_useful].freeze

    def self.call(feedback)
      new(feedback).call
    end

    def initialize(feedback)
      @feedback = feedback
      @item = feedback.surface_item
    end

    def call
      return unless @item
      return unless positive? || negative?

      observe("renderer", @item.renderer)
      observe("kind", @item.kind)
      observe("intent", @item.intent)
      Array(@item.context_refs).each { |reference| observe("context_type", reference["type"] || reference[:type]) }
      Array(@item.source_refs).each { |reference| observe("source_type", reference["type"] || reference[:type]) }
    end

    private

    def positive?
      POSITIVE.include?(@feedback.signal)
    end

    def negative?
      NEGATIVE.include?(@feedback.signal)
    end

    def observe(dimension, value)
      return if value.blank?

      preference = SurfacePreference.find_or_create_by!(dimension: dimension, value: value)
      preference.with_lock { preference.observe!(positive: positive?) }
    end
  end
end
