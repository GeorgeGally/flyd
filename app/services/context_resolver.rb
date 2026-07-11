class ContextResolver
  AUTO_ROUTE_THRESHOLD = 0.80

  Result = Data.define(:project, :confidence, :reason, :requires_confirmation)

  def self.call(text:, preferred_project_id: nil)
    new(text:, preferred_project_id:).call
  end

  def initialize(text:, preferred_project_id: nil)
    @text = text.to_s.strip
    @preferred_project_id = preferred_project_id
  end

  def call
    preferred = Project.active.find_by(id: @preferred_project_id)
    return Result.new(project: preferred, confidence: 1.0, reason: "active surface context", requires_confirmation: false) if preferred

    projects = Project.active.includes(:decisions, :beliefs).to_a
    return Result.new(project: nil, confidence: 0.0, reason: "no active projects", requires_confirmation: false) if projects.empty?

    project, raw_score = projects.map { |candidate| [candidate, score(candidate)] }.max_by(&:last)
    confidence = confidence_for(raw_score)

    if confidence < AUTO_ROUTE_THRESHOLD
      return Result.new(
        project: nil,
        confidence: confidence,
        reason: "context was ambiguous",
        requires_confirmation: true
      )
    end

    Result.new(
      project: project,
      confidence: confidence,
      reason: "matched project name, description, and remembered context",
      requires_confirmation: false
    )
  end

  private

  def score(project)
    recent_decisions = project.decisions.sort_by(&:created_at).last(5).map(&:content)
    recent_beliefs = project.beliefs.sort_by(&:updated_at).last(5).map(&:statement)
    haystack = [project.name, project.description, recent_decisions, recent_beliefs].flatten.compact.join(" ").downcase

    terms = @text.downcase.scan(/[a-z0-9]{3,}/).uniq
    exact_name_bonus = project.name.present? && @text.downcase.include?(project.name.downcase) ? 4 : 0
    exact_name_bonus + terms.count { |term| haystack.match?(/\b#{Regexp.escape(term)}\b/) }
  end

  def confidence_for(raw_score)
    return 0.0 if raw_score.zero?

    [0.60 + (raw_score * 0.07), 0.96].min
  end
end
