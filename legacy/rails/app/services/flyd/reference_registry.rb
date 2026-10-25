require "set"

module Flyd
  class ReferenceRegistry
    def self.call(state)
      new(state).call
    end

    def initialize(state)
      @state = state.deep_symbolize_keys
      @references = Set.new
    end

    def call
      register_record("scene", @state.dig(:current_work, :id))
      register_record("artifact", @state.dig(:current_work, :resolved_artifact_id))
      register_record("intent", @state.dig(:active_intent, :id))
      register_record("conversation", @state.dig(:active_interaction, :id))
      Array(@state.dig(:active_interaction, :messages)).each { |message| register_record("message", message[:id]) }

      register_record("surface", @state.dig(:previous_surface, :id))
      Array(@state.dig(:previous_surface, :items)).each do |item|
        register_record("surface_item", item[:id])
        register_record("scene", item[:scene_id])
      end

      Array(@state[:scenes]).each do |scene|
        register_record("scene", scene[:id])
        register_record("artifact", scene[:resolved_artifact_id])
      end
      Array(@state[:artifacts]).each { |artifact| register_record("artifact", artifact[:id]) }
      Array(@state[:builds]).each { |build| register_record("build", build[:id]) }

      Array(@state[:projects]).each do |project|
        register_record("project", project[:id])
        Array(project[:decisions]).each { |decision| register_record("decision", decision[:id]) }
        Array(project[:beliefs]).each { |belief| register_record("belief", belief[:id]) }
      end

      Array(@state.dig(:provider_state, :providers)).each do |provider|
        provider[:data].to_h.each_value do |items|
          Array(items).each { |item| register_record(item[:type], item[:id]) }
        end
      end

      Array(@state[:active_intent_evidence]).each { |attachment| register_record("intent_attachment", attachment[:id]) }
      Array(@state[:temporary_contexts]).each { |context| register_record("context", context[:id]) }
      @references.to_a
    end

    private

    def register_record(type, id)
      return if type.blank? || id.blank?

      @references << "#{type}:#{id}"
    end
  end
end
