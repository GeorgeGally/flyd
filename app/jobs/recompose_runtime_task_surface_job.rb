class RecomposeRuntimeTaskSurfaceJob < ApplicationJob
  queue_as :default

  def perform(agent_task_id, expected_revision)
    task = AgentTask.find_by(id: agent_task_id)
    return unless task && task.revision == expected_revision

    ComposeSurfaceJob.enqueue(reason: "runtime_phase_change")
  end
end
