class ContextResolver
  AUTO_ROUTE_THRESHOLD = 0.84
  MIN_SCORE = 5.0
  MIN_MARGIN = 2.0
  STOP_WORDS = %w[
    the and for with from this that have has had into about what when where why how
    are was were will would should could can just like need want make made fix use
    our your their its not but all any some more less very then than also across
  ].freeze

  Result = Struct.new(:project, :context, :confidence, :reason, :requires_confirmation, :candidates, keyword_init: true) do
    def owner
      project || context
    end
  end

  Candidate = Data.define(:type, :record, :score)

  def self.call(text:, preferred_project_id: nil)
    new(text:, preferred_project_id:).call
  end

  def initialize(text:, preferred_project_id: nil)
    @text = text.to_s.strip
    @preferred_project_id = preferred_project_id
  end

  def call
    preferred = Project.active.find_by(id: @preferred_project_id)
    if preferred
      return Result.new(
        project: preferred,
        context: nil,
        confidence: 1.0,
        reason: "explicit active surface context",
        requires_confirmation: false,
        candidates: [ Candidate.new(type: "project", record: preferred, score: 100.0) ]
      )
    end

    ranked = rank_candidates
    return empty_result if ranked.empty?

    best = ranked.first
    runner_up = ranked.second
    margin = best.score - (runner_up&.score || 0.0)
    confidence = confidence_for(best.score, margin)
    uniquely_strong = best.score >= MIN_SCORE && margin >= MIN_MARGIN && confidence >= AUTO_ROUTE_THRESHOLD

    Result.new(
      project: best.type == "project" ? best.record : nil,
      context: best.type == "context" ? best.record : nil,
      confidence: confidence,
      reason: uniquely_strong ? "uniquely matched named and remembered context" : "context was ambiguous or insufficiently distinct",
      requires_confirmation: !uniquely_strong,
      candidates: ranked.first(3)
    )
  end

  private

  def empty_result
    Result.new(
      project: nil,
      context: nil,
      confidence: 0.0,
      reason: "no active contexts",
      requires_confirmation: true,
      candidates: []
    )
  end

  def rank_candidates
    project_candidates = Project.active.map do |project|
      Candidate.new(type: "project", record: project, score: project_score(project))
    end
    context_candidates = Context.active.map do |context|
      Candidate.new(type: "context", record: context, score: record_score(context.name, context.description))
    end

    (project_candidates + context_candidates).select { |candidate| candidate.score.positive? }.sort_by { |candidate| -candidate.score }
  end

  def project_score(project)
    recent_decisions = project.decisions.order(created_at: :desc).limit(5).pluck(:content)
    recent_beliefs = project.beliefs.order(updated_at: :desc).limit(5).pluck(:statement)
    record_score(project.name, project.description, recent_decisions, recent_beliefs)
  end

  def record_score(name, *supporting_text)
    normalized_name = normalize(name)
    name_terms = terms(normalized_name)
    support_terms = terms(supporting_text.flatten.compact.join(" "))
    input_terms = terms(@text)
    exact_name = normalized_name.present? && @text.downcase.match?(/(?:\A|\b)#{Regexp.escape(normalized_name)}(?:\b|\z)/)

    name_matches = input_terms & name_terms
    score = exact_name ? 6.0 : 0.0
    score += name_matches.length * 2.5
    score += (input_terms & support_terms).length * 0.75
    return score if exact_name || name_matches.any?

    [score, MIN_SCORE - 0.01].min
  end

  def terms(value)
    normalize(value).scan(/[a-z0-9]{3,}/).reject { |term| STOP_WORDS.include?(term) }.uniq
  end

  def normalize(value)
    value.to_s.downcase.gsub(/[^a-z0-9\s-]/, " ").squish
  end

  def confidence_for(score, margin)
    return 0.0 if score.zero?

    [ 0.55 + (score * 0.045) + ([ margin, 5.0 ].min * 0.035), 0.97 ].min
  end
end
