class DecisionExtractionJob < ApplicationJob
  queue_as :default

  def perform(conversation_id)
    conversation = Conversation.find(conversation_id)
    return unless conversation.project

    engine = Subsystems::MemoryEngine.new(conversation.project)
    engine.extract_decisions(conversation)

    ComposeSurfaceJob.enqueue(reason: "memory_update", active_conversation_id: conversation.id)
  end
end
