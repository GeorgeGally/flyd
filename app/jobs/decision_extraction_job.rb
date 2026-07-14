class DecisionExtractionJob < ApplicationJob
  queue_as :default

  def perform(conversation_id)
    conversation = Conversation.find(conversation_id)
    return unless conversation.project

    engine = Subsystems::MemoryEngine.new(conversation.project)
    existing_ids = conversation.project.decisions.ids
    engine.extract_decisions(conversation)
    decision_ids = conversation.project.decisions.where.not(id: existing_ids).pluck(:id)

    if decision_ids.any?
      BeliefSynthesisJob.perform_later(conversation.project_id, decision_ids: decision_ids)
    end

    ComposeSurfaceJob.enqueue(reason: "memory_update", active_conversation_id: conversation.id)
  end
end
