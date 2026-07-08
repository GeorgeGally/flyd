class BeliefSynthesisJob < ApplicationJob
  queue_as :default

  def perform(project_id)
    project = Project.find(project_id)
    engine = Subsystems::BeliefEngine.new(project)
    recent_decisions = project.decisions.where(extracted_at: 1.day.ago..Time.current)
    engine.synthesize(recent_decisions)
  end
end
