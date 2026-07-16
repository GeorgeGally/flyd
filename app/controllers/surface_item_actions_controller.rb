class SurfaceItemActionsController < ApplicationController
  DIRECT_ACTIONS = %w[discuss answer choose investigate build].freeze

  def create
    item = SurfaceItem.includes(:scene, :surface).find(params[:surface_item_id])
    action_id = params.require(:action_id)
    action = item.offered_action(action_id, option_id: requested_option_id)
    unless DIRECT_ACTIONS.include?(action_id) && SurfaceActions::Registry.supported?(action_id) && action
      raise ArgumentError, "Action is not available for this item."
    end

    case action_id
    when "discuss", "answer"
      conversation = conversation_for(item)
      record_feedback(item, "discussed")
      redirect_to root_path(conversation_id: conversation.id)
    when "choose"
      choose_option(item, action)
      redirect_to root_path, notice: "Decision recorded."
    when "investigate"
      conversation = begin_investigation(item, action)
      redirect_to root_path(conversation_id: conversation.id), notice: "Investigation started."
    when "build"
      build = propose_build(item, action)
      redirect_to build_path(build), notice: build.proposed? ? "Review the action before it runs." : "This scene already has an active action."
    else
      redirect_to root_path, alert: "Action is not available."
    end
  rescue ArgumentError, ActiveRecord::RecordNotFound => error
    redirect_to root_path, alert: error.message
  end

  private

  def choose_option(item, action)
    Surface.with_transition_lock do
      payload = persisted_payload(action)
      option_id = payload.fetch("option_id")
      option_label = payload.fetch("option_label")
      scene = item.scene || raise(ActiveRecord::RecordNotFound, "Decision scene is unavailable")
      conversation = scene.conversation

      artifact = Artifact.create!(
        scene: scene,
        project: scene.project,
        context: scene.context,
        conversation: conversation,
        kind: "decision",
        status: "ready",
        title: item.title,
        content: option_label,
        metadata: {
          "option_id" => option_id,
          "surface_id" => item.surface_id,
          "surface_item_id" => item.id
        }
      )

      if conversation
        message = conversation.messages.create!(
          role: "user",
          content: "Decision: #{option_label}",
          metadata: { "decision_artifact_id" => artifact.id }
        )
        if conversation.project
          Decision.create!(
            conversation: conversation,
            project: conversation.project,
            source_message: message,
            content: option_label,
            confidence: 1.0,
            extracted_at: Time.current
          )
        end
      end

      scene.resolve!(artifact: artifact, summary: option_label)
      item.update!(state: "collapsed", metadata: item.metadata.merge("chosen_option_id" => option_id))
      record_feedback(item, "resolved")
      ComposeSurfaceJob.enqueue(reason: "decision_made")
    end
  end

  def begin_investigation(item, action)
    conversation = conversation_for(item)
    question = persisted_payload(action).fetch("question")
    scene = item.scene || conversation.primary_scene
    scene&.present!(
      title: item.title,
      summary: item.summary,
      kind: "investigation",
      conversation: conversation,
      project: conversation.project,
      context: conversation.context
    )
    scene&.update!(desired_outcome: "Answer: #{question}")

    message = conversation.messages.create!(
      role: "user",
      content: "Investigate this question:\n\n#{question}",
      metadata: { "requested_capability" => "investigate", "surface_item_id" => item.id }
    )
    record_feedback(item, "discussed")
    LlmStreamingJob.perform_later(conversation.id, message.content)
    ComposeSurfaceJob.enqueue(reason: "investigation_started", active_conversation_id: conversation.id)
    conversation
  end

  def requested_option_id
    legacy_payload = params[:payload]
    legacy_option_id = legacy_payload.dig(:option_id) if legacy_payload.respond_to?(:dig)
    params[:option_id].presence || legacy_option_id.presence
  end

  def persisted_payload(action)
    action.fetch("payload", {}).to_h.deep_stringify_keys
  end

  def record_feedback(item, signal)
    feedback = SurfaceFeedback.create!(surface: item.surface, surface_item: item, signal: signal)
    Surfaces::LearnFromFeedback.call(feedback)
    feedback
  end

  def propose_build(item, action)
    conversation = conversation_for(item)
    raise ArgumentError, "Build currently requires a project-owned scene" unless conversation.project

    Builds::Propose.call(
      project: conversation.project,
      conversation: conversation,
      scene: item.scene || conversation.primary_scene,
      surface_item: item,
      instructions: persisted_payload(action)["instructions"]
    )
  end

  def conversation_for(item)
    return item.scene.conversation if item.scene&.conversation&.continuable?

    owner = owner_for(item)
    conversation = Conversation.active_for(owner).first || Conversation.start!(owner, summary: item.title.truncate(120))
    if item.scene
      item.scene.update!(
        conversation: conversation,
        project: owner.is_a?(Project) ? owner : nil,
        context: owner.is_a?(Context) ? owner : nil
      )
    end
    conversation
  end

  def owner_for(item)
    reference = Array(item.context_refs).find do |candidate|
      %w[project context].include?(candidate["type"] || candidate[:type])
    end

    if reference
      type = reference["type"] || reference[:type]
      id = reference["id"] || reference[:id]
      owner = type == "project" ? Project.active.find_by(id: id) : Context.active.find_by(id: id)
      return owner if owner
    end

    return item.scene.project if item.scene&.project && !item.scene.project.archived?
    return item.scene.context if item.scene&.context&.status == "active"

    Context.create!(
      name: item.title.truncate(120),
      kind: "temporary",
      description: item.summary,
      expires_at: 7.days.from_now,
      metadata: { "generated_from_scene_id" => item.scene_id }
    )
  end
end
