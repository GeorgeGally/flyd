class DecisionExtractionJob < ApplicationJob
  queue_as :default

  def perform(conversation_id)
    conversation = Conversation.find(conversation_id)
    engine = Subsystems::MemoryEngine.new(conversation.project)
    engine.extract_decisions(conversation)
  end
end
