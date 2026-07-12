module Flyd
  class WorldStateExtensions
    def self.call(compiled:, active_intent: nil)
      new(compiled:, active_intent:).call
    end

    def initialize(compiled:, active_intent:)
      @compiled = compiled
      @active_intent = active_intent
    end

    def call
      state = @compiled.state.deep_dup
      references = @compiled.reference_registry.dup

      state[:active_intent_evidence] = attachment_state(references)
      state[:temporary_contexts] = context_state(references)
      state[:learned_surface_preferences] = preference_state

      WorldStateCompiler::Result.new(
        state: state,
        reference_registry: references,
        diagnostics: @compiled.diagnostics.merge(input_characters: JSON.generate(state).length)
      )
    end

    private

    def attachment_state(references)
      return [] unless @active_intent

      @active_intent.intent_attachments.map do |attachment|
        references << "intent_attachment:#{attachment.id}"
        {
          id: attachment.id,
          modality: attachment.modality,
          filename: attachment.filename,
          content_type: attachment.content_type,
          byte_size: attachment.byte_size,
          extracted_text: attachment.extracted_text.to_s.truncate(4_000),
          metadata: attachment.metadata
        }
      end
    end

    def context_state(references)
      Context.active.order(updated_at: :desc).limit(12).map do |context|
        references << "context:#{context.id}"
        {
          id: context.id,
          name: context.name,
          kind: context.kind,
          description: context.description.to_s.truncate(700),
          expires_at: context.expires_at&.iso8601
        }
      end
    end

    def preference_state
      SurfacePreference.meaningful.limit(20).map do |preference|
        {
          dimension: preference.dimension,
          value: preference.value,
          weight: preference.weight.round(3),
          positive_count: preference.positive_count,
          negative_count: preference.negative_count,
          last_observed_at: preference.last_observed_at&.iso8601
        }
      end
    end
  end
end
