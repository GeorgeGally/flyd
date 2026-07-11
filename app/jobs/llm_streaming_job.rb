class LlmStreamingJob < ApplicationJob
  queue_as :default

  retry_on StandardError, wait: :exponentially_longer, attempts: 3

  def perform(conversation_id, _user_message_content)
    conversation = Conversation.find(conversation_id)

    messages = conversation.messages.ordered.map do |msg|
      { role: msg.role, content: msg.content }
    end

    messages.unshift({ role: "system", content: system_prompt(conversation.project, conversation) })

    provider = Llm::Provider.for(Flyd::KeyLoader.default_model)
    full_response = ""

    begin
      full_response = provider.stream(messages) do |token|
        ChatChannel.broadcast_to(conversation, { token: token })
      end
    rescue => e
      Rails.logger.error("LlmStreamingJob failed: #{e.message}")
      ChatChannel.broadcast_to(conversation, { token: "\n\nError: #{e.message}. Check your API key and try again." })
      return
    end

    assistant_message = conversation.messages.create!(
      role: "assistant",
      content: full_response,
      tokens_count: provider.count_tokens(full_response)
    )

    ChatChannel.broadcast_to(conversation, { done: true, message_id: assistant_message.id })
    ComposeSurfaceJob.enqueue(reason: "assistant_response", active_conversation_id: conversation.id)
  end

  private

  def system_prompt(project, conversation)
    base = <<~PROMPT
      You are Flyd, a persistent intelligence working within the context "#{project.name}".
      You help with thinking, planning, and building.
      Be concise, direct, and helpful. Use markdown when appropriate.
      The interface is the intelligence expressed: respond with the clearest useful form for the current context rather than assuming chat is the product.
    PROMPT

    engine = Subsystems::MemoryEngine.new(project)
    base = engine.inject_context_into_prompt(base)

    beh_engine = Subsystems::BehaviourEngine.new(project)
    last_user_msg = conversation.messages.ordered.where(role: "user").last
    if last_user_msg && (steps = beh_engine.inject_behaviour_steps(last_user_msg.content))
      base += "\n\n## Detected Behaviour Pattern\nThis conversation matches a known pattern. Suggested steps:\n#{steps.map { |s| "#{s[:step]}. #{s[:action]}" }.join("\n")}\n"
    end

    base
  end
end
