module Intents
  class ApplyContextCorrection
    def self.call(intent:, corrected_contexts:)
      new(intent:, corrected_contexts:).call
    end

    def initialize(intent:, corrected_contexts:)
      @intent = intent
      @corrected_contexts = corrected_contexts
    end

    def call
      owner = resolve_owner
      old_conversation = @intent.conversation
      old_message = source_message(old_conversation)
      affected_decisions = decisions_for(old_message)

      if owner.nil?
        remove_project_memory!(affected_decisions)
        supersede_source_message!(old_message, replacement: nil)
        retire_if_empty!(old_conversation, replacement: nil)
        @intent.update!(
          status: "accepted",
          conversation: nil,
          resolved_contexts: [],
          metadata: append_history(old_conversation, nil, old_message, nil)
        )
        return nil
      end

      if old_conversation&.owner == owner
        @intent.update!(status: "accepted", resolved_contexts: @corrected_contexts)
        return old_conversation
      end

      new_conversation = Conversation.start!(owner, summary: effective_text.truncate(120))
      new_message = new_conversation.messages.create!(role: "user", content: effective_text)

      if owner.is_a?(Project)
        move_project_memory!(affected_decisions, new_conversation, new_message)
      else
        remove_project_memory!(affected_decisions)
      end

      supersede_source_message!(old_message, replacement: new_message)
      retire_if_empty!(old_conversation, replacement: new_conversation)

      @intent.update!(
        status: "accepted",
        conversation: new_conversation,
        resolved_contexts: @corrected_contexts,
        metadata: append_history(old_conversation, new_conversation, old_message, new_message)
          .merge("source_message_id" => new_message.id)
      )

      LlmStreamingJob.perform_later(new_conversation.id, new_message.content)
      BeliefSynthesisJob.perform_later(new_conversation.project_id) if new_conversation.project_id && affected_decisions.any?
      new_conversation
    end

    private

    def resolve_owner
      return if @corrected_contexts.empty?
      raise ArgumentError, "Intent interaction supports one primary context" if @corrected_contexts.length > 1

      reference = @corrected_contexts.first
      case reference["type"]
      when "project" then Project.active.find(reference["id"])
      when "context" then Context.active.find(reference["id"])
      end
    end

    def effective_text
      parts = [ @intent.input_text ]
      parts.concat(@intent.intent_attachments.filter_map(&:extracted_text))
      parts.compact_blank.join("\n\n").presence || "#{@intent.modality} attachment requiring interpretation"
    end

    def source_message(conversation)
      message_id = @intent.metadata["source_message_id"]
      return Message.find_by(id: message_id, conversation: conversation) if message_id.present?

      conversation&.messages&.where(role: "user")&.order(created_at: :desc)&.first
    end

    def decisions_for(message)
      return Decision.none unless message

      Decision.where(source_message: message)
    end

    def move_project_memory!(decisions, new_conversation, new_message)
      decision_ids = decisions.pluck(:id)
      return if decision_ids.empty?

      challenge_dependent_beliefs!(decisions.first.project, decision_ids)
      decisions.update_all(
        conversation_id: new_conversation.id,
        project_id: new_conversation.project_id,
        source_message_id: new_message.id,
        updated_at: Time.current
      )
    end

    def remove_project_memory!(decisions)
      decision_ids = decisions.pluck(:id)
      return if decision_ids.empty?

      project = decisions.first.project
      challenge_dependent_beliefs!(project, decision_ids)
      decisions.destroy_all
    end

    def challenge_dependent_beliefs!(project, decision_ids)
      return unless project

      project.beliefs.find_each do |belief|
        belief.remove_sources!(decision_ids) if belief.depends_on_any?(decision_ids)
      end
    end

    def supersede_source_message!(message, replacement:)
      return unless message

      message.update!(
        metadata: message.metadata.merge(
          "context_superseded" => true,
          "replacement_message_id" => replacement&.id,
          "context_corrected_at" => Time.current.iso8601
        )
      )
    end

    def retire_if_empty!(conversation, replacement:)
      return unless conversation

      remaining_user_messages = conversation.messages.where(role: "user").reject(&:context_superseded?)
      return if remaining_user_messages.any?

      replacement ? conversation.supersede_by!(replacement) : conversation.archive!
    end

    def append_history(old_conversation, new_conversation, old_message, new_message)
      history = Array(@intent.metadata["context_correction_history"])
      history << {
        "corrected_at" => Time.current.iso8601,
        "from_conversation_id" => old_conversation&.id,
        "to_conversation_id" => new_conversation&.id,
        "from_message_id" => old_message&.id,
        "to_message_id" => new_message&.id,
        "contexts" => @corrected_contexts
      }
      @intent.metadata.merge("context_correction_history" => history.last(20))
    end
  end
end
