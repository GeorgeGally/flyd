class BeliefSynthesisJob < ApplicationJob
  queue_as :default

  def perform(project_id = nil)
    projects = project_id ? Project.where(id: project_id) : Project.active
    changed = false

    projects.find_each do |project|
      engine = Subsystems::BeliefEngine.new(project)
      recent_decisions = project.decisions.where(extracted_at: 1.day.ago..Time.current)
      before_count = project.beliefs.count
      engine.synthesize(recent_decisions)
      changed ||= project.beliefs.count != before_count
    end

    ComposeSurfaceJob.enqueue(reason: "belief_update") if changed
  end
end
