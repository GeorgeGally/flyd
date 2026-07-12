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

      if owner.nil?
        archive_unowned_conversation(old_conversation)
        @intent.update!(
          status: "accepted",
          conversation: nil,
          resolved_contexts: [],
          metadata: append_history(old_conversation, nil)
        )
        return nil
      end

      if old_conversation&.owner == owner
        @intent.update!(status: "accepted", resolved_contexts: @corrected_contexts)
        return old_conversation
      end

      new_conversation = Conversation.start!(owner, summary: effective_text.truncate(120))
      message = new_conversation.messages.create!(role: "user", content: effective_text)
      reassign_project_decisions(old_conversation, new_conversation, message) if owner.is_a?(Project)
      old_conversation&.supersede_by!(new_conversation)

      @intent.update!(
        status: "accepted",
        conversation: new_conversation,
        resolved_contexts: @corrected_contexts,
        metadata: append_history(old_conversation, new_conversation)
      )

      LlmStreamingJob.perform_later(new_conversation.id, message.content)
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

    def reassign_project_decisions(old_conversation, new_conversation, source_message)
      return unless old_conversation

      old_conversation.decisions.update_all(
        conversation_id: new_conversation.id,
        project_id: new_conversation.project_id,
        source_message_id: source_message.id,
        updated_at: Time.current
      )
    end

    def archive_unowned_conversation(conversation)
      conversation&.archive! if conversation&.active?
    end

    def append_history(old_conversation, new_conversation)
      history = Array(@intent.metadata["context_correction_history"])
      history << {
        "corrected_at" => Time.current.iso8601,
        "from_conversation_id" => old_conversation&.id,
        "to_conversation_id" => new_conversation&.id,
        "contexts" => @corrected_contexts
      }
      @intent.metadata.merge("context_correction_history" => history.last(20))
    end
  end
end
