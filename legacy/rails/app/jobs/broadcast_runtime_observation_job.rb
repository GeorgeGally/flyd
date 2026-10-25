class BroadcastRuntimeObservationJob < ApplicationJob
  queue_as :default

  def perform(task_key, expected_revision)
    task = AgentTask.find_by(task_key:)
    return unless task&.revision == expected_revision

    surface = Surface.current
    return unless surface
    return unless surface.items.any? { |item| bound_to?(item, task) }

    Turbo::StreamsChannel.broadcast_replace_to(
      "flyd_surface",
      target: "surface_plane",
      partial: "surfaces/plane",
      locals: { surface: surface.reload, active_conversation: nil },
      method: :morph
    )
  end

  private

  def bound_to?(item, task)
    item.renderer.in?(%w[task_orientation task_plan worker_monitor task_review task_completion]) &&
      Array(item.source_refs).any? do |reference|
        reference.to_h.deep_stringify_keys == { "type" => "runtime_task", "id" => task.task_key }
      end
  end
end
