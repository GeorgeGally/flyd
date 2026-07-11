module Surface
  Item = Data.define(
    :id,
    :kind,
    :intent,
    :title,
    :summary,
    :priority,
    :renderer,
    :depth,
    :state,
    :project,
    :source
  )

  Plan = Data.define(:generated_at, :focus_item_id, :items)

  class Planner
    MAX_ITEMS = 3

    def self.call
      new.call
    end

    def call
      items = candidate_projects.filter_map { |project| build_item(project) }
      items = items.sort_by { |item| -item.priority }.first(MAX_ITEMS)
      items = [welcome_item] if items.empty?

      Plan.new(
        generated_at: Time.current,
        focus_item_id: items.first.id,
        items: assign_depth(items)
      )
    end

    private

    def candidate_projects
      Project.active
        .left_joins(:conversations)
        .group(:id)
        .order(Arel.sql("MAX(conversations.updated_at) DESC NULLS LAST"))
        .limit(8)
    end

    def build_item(project)
      decision = project.decisions.order(created_at: :desc).first
      belief = project.beliefs.order(updated_at: :desc).first
      conversation = project.conversations.order(updated_at: :desc).first

      evidence = decision&.content.presence || belief&.statement.presence || project.description.presence
      return if evidence.blank? && conversation.blank?

      score = score_project(project, decision:, belief:, conversation:)

      Item.new(
        id: "project-#{project.id}",
        kind: infer_kind(decision:, belief:),
        intent: infer_intent(decision:, belief:),
        title: project.name,
        summary: evidence || "Recent activity is ready to continue.",
        priority: score,
        renderer: score >= 70 ? "hero_scene" : "card",
        depth: "middle",
        state: "prepared",
        project: project,
        source: decision || belief || conversation
      )
    end

    def score_project(project, decision:, belief:, conversation:)
      score = 20
      score += recency_score(project.last_activity_at)
      score += 20 if decision.present?
      score += ((belief&.confidence || 0.0) * 15).round
      score += 10 if conversation&.active?
      score.clamp(0, 100)
    end

    def recency_score(timestamp)
      return 0 unless timestamp

      hours = ((Time.current - timestamp) / 1.hour).clamp(0, 168)
      (35 * (1 - (hours / 168.0))).round
    end

    def infer_kind(decision:, belief:)
      return "decision" if decision.present?
      return "insight" if belief.present?

      "scene"
    end

    def infer_intent(decision:, belief:)
      return "review" if decision.present?
      return "inform" if belief.present?

      "discuss"
    end

    def assign_depth(items)
      items.each_with_index.map do |item, index|
        item.with(
          renderer: index.zero? ? "hero_scene" : "card",
          depth: index.zero? ? "foreground" : "middle",
          state: "presented"
        )
      end
    end

    def welcome_item
      Item.new(
        id: "welcome",
        kind: "scene",
        intent: "discuss",
        title: "What deserves your attention?",
        summary: "Tell Flyd what is happening. It will resolve the context and shape the surface around it.",
        priority: 0,
        renderer: "hero_scene",
        depth: "foreground",
        state: "presented",
        project: nil,
        source: nil
      )
    end
  end
end
