class BeliefSynthesisJob < ApplicationJob
  queue_as :default

  def perform(project_id = nil, decision_ids: nil)
    projects = project_id ? Project.where(id: project_id) : Project.active
    changed = false

    projects.find_each do |project|
      decisions = if decision_ids.present?
        project.decisions.where(id: decision_ids)
      else
        project.decisions.where(extracted_at: 1.day.ago..Time.current)
      end
      next unless decisions.exists?

      Subsystems::BeliefEngine.new(project).synthesize(decisions)
      changed = true
    end

    ComposeSurfaceJob.enqueue(reason: "belief_update") if changed
  end
end
