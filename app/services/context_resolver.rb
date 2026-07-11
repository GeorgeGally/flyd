class ContextResolver
  Result = Data.define(:project, :confidence, :reason)

  def self.call(text:, preferred_project_id: nil)
    new(text:, preferred_project_id:).call
  end

  def initialize(text:, preferred_project_id: nil)
    @text = text.to_s.strip
    @preferred_project_id = preferred_project_id
  end

  def call
    preferred = Project.active.find_by(id: @preferred_project_id)
    return Result.new(project: preferred, confidence: 1.0, reason: "active surface context") if preferred

    projects = Project.active.to_a
    return Result.new(project: nil, confidence: 0.0, reason: "no active projects") if projects.empty?

    ranked = projects.map { |project| [project, score(project)] }.sort_by { |(_, value)| -value }
    project, value = ranked.first

    if value.zero?
      project = projects.max_by(&:last_activity_at)
      return Result.new(project:, confidence: 0.45, reason: "most recent active context")
    end

    confidence = [0.55 + (value * 0.08), 0.96].min
    Result.new(project:, confidence:, reason: "matched project name, description, and remembered context")
  end

  private

  def score(project)
    haystack = [
      project.name,
      project.description,
      project.decisions.order(created_at: :desc).limit(5).pluck(:content),
      project.beliefs.order(updated_at: :desc).limit(5).pluck(:statement)
    ].flatten.compact.join(" ").downcase

    terms = @text.downcase.scan(/[a-z0-9]{3,}/).uniq
    terms.sum { |term| haystack.include?(term) ? 1 : 0 }
  end
end
