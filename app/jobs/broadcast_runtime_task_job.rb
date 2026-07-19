class BroadcastRuntimeTaskJob < ApplicationJob
  queue_as :default

  retry_on StandardError, wait: :polynomially_longer, attempts: 5

  def perform(runtime_event_id)
    event = RuntimeEvent.includes(:agent_task).find(runtime_event_id)
    surface = Surface.current
    return mark_delivered(event) unless surface

    if surface.items.any? { |item| bound_to?(item, event.agent_task) }
      surface.reload
      Turbo::StreamsChannel.broadcast_replace_to(
        "flyd_surface",
        target: "surface_plane",
        partial: "surfaces/plane",
        locals: { surface: surface, active_conversation: nil, runtime_event: event },
        method: :morph
      )
    end
    mark_delivered(event)
  end

  private

  def bound_to?(item, task)
    item.renderer.in?(%w[task_orientation task_plan worker_monitor task_review task_completion]) &&
      Array(item.source_refs).any? do |reference|
        reference.to_h.deep_stringify_keys == { "type" => "runtime_task", "id" => task.task_key }
      end
  end

  def mark_delivered(event)
    delivered_at = Time.current
    latency_ms = [ ((delivered_at - event.occurred_at) * 1_000).round, 0 ].max
    event.update_columns(broadcast_delivered_at: delivered_at, updated_at: delivered_at)
    RuntimeDeliveryState
      .where(listener_key: AgentRuntime::EventListener::LISTENER_KEY, last_event_id: event.id)
      .update_all(
        last_delivered_at: delivered_at,
        delivery_latency_ms: latency_ms,
        updated_at: delivered_at
      )
  end
end
