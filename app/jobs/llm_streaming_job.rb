class LlmStreamingJob < ApplicationJob
  queue_as :default

  retry_on StandardError, wait: :exponentially_longer, attempts: 3

  def perform(conversation_id, _user_message_content)
    conversation = Conversation.find(conversation_id)

    visible_messages = conversation.messages.ordered.reject(&:context_superseded?)
    messages = visible_messages.map do |message|
      { role: message.role, content: message.content }
    end
    messages.unshift({ role: "system", content: system_prompt(conversation, visible_messages) })

    provider = Llm::Provider.for(Flyd::KeyLoader.default_model)
    full_response = provider.stream(messages) do |token|
      ChatChannel.broadcast_to(conversation, { token: token })
    end

    assistant_message = conversation.messages.create!(
      role: "assistant",
      content: full_response,
      tokens_count: provider.count_tokens(full_response)
    )

    ChatChannel.broadcast_to(conversation, { done: true, message_id: assistant_message.id })
    intent = Intent.where(conversation: conversation).order(created_at: :desc).first
    ComposeSurfaceJob.enqueue(
      reason: "assistant_response",
      active_conversation_id: conversation.id,
      active_intent_id: intent&.id
    )
  rescue StandardError => error
    Rails.logger.error("LlmStreamingJob failed: #{error.message}")
    ChatChannel.broadcast_to(conversation, { token: "\n\nError: #{error.message}. Check your API key and try again." }) if conversation
    raise
  end

  private

  def system_prompt(conversation, visible_messages)
    owner = conversation.owner
    base = <<~PROMPT
      You are Flyd, a persistent intelligence working within the context "#{conversation.owner_name}".
      You help with thinking, planning, and building.
      Be concise, direct, and helpful. Use markdown when appropriate.
      The interface is the intelligence expressed: respond with the clearest useful form for the current context rather than assuming chat is the product.
    PROMPT

    if owner.is_a?(Project)
      base = Subsystems::MemoryEngine.new(owner).inject_context_into_prompt(base)
      last_user_message = visible_messages.reverse.find { |message| message.role == "user" }
      steps = Subsystems::BehaviourEngine.new(owner).inject_behaviour_steps(last_user_message.content) if last_user_message
      if steps
        base += "\n\n## Detected Behaviour Pattern\nThis conversation matches a known pattern. Suggested steps:\n#{steps.map { |step| "#{step[:step]}. #{step[:action]}" }.join("\n")}\n"
      end
    elsif owner.is_a?(Context) && owner.description.present?
      base += "\n\n## Context\n#{owner.description}\n"
    end

    base
  end
end
