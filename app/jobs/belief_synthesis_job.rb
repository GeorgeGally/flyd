class BeliefSynthesisJob < ApplicationJob
  queue_as :default

  def perform(project_id = nil)
    projects = project_id ? Project.where(id: project_id) : Project.active
    changed = false

    projects.find_each do |project|
      recent_decisions = project.decisions.where(extracted_at: 1.day.ago..Time.current)
      next unless recent_decisions.exists?

      Subsystems::BeliefEngine.new(project).synthesize(recent_decisions)
      changed = true
    end

    ComposeSurfaceJob.enqueue(reason: "belief_update") if changed
  end
end
