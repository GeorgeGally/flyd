module Surface
  Item = Data.define(:id, :kind, :intent, :title, :summary, :priority, :renderer, :depth, :state, :project, :source)
  Plan = Data.define(:generated_at, :focus_item_id, :items)

  class Planner
    MAX_ITEMS = 3

    def self.call = new.call

    def call
      items = candidates.sort_by { |item| -item.priority }.first(MAX_ITEMS)
      items = [welcome_item] if items.empty?

      Plan.new(generated_at: Time.current, focus_item_id: items.first.id, items: assign_depth(items))
    end

    private

    def candidates
      decision_items + belief_items
    end

    def decision_items
      Decision.includes(:project).order(created_at: :desc).limit(20).filter_map do |decision|
        next unless decision.project&.archived_at.nil?

        build_item(
          id: "decision-#{decision.id}",
          kind: "decision",
          intent: "review",
          title: decision.content.truncate(90),
          summary: "A remembered decision in #{decision.project.name} may deserve review.",
          priority: recency_score(decision.created_at) + ((decision.confidence || 0.5) * 35).round,
          project: decision.project,
          source: decision
        )
      end
    end

    def belief_items
      Belief.includes(:project).order(updated_at: :desc).limit(20).filter_map do |belief|
        next unless belief.project&.archived_at.nil?

        build_item(
          id: "belief-#{belief.id}",
          kind: "insight",
          intent: belief.status == "contradicted" ? "decide" : "inform",
          title: belief.statement.truncate(90),
          summary: "Current belief in #{belief.project.name}. Confidence #{((belief.confidence || 0.5) * 100).round}%.",
          priority: recency_score(belief.updated_at) + ((belief.confidence || 0.5) * 30).round + (belief.status == "contradicted" ? 25 : 0),
          project: belief.project,
          source: belief
        )
      end
    end

    def build_item(id:, kind:, intent:, title:, summary:, priority:, project:, source:)
      Item.new(
        id:, kind:, intent:, title:, summary:, priority: priority.clamp(0, 100),
        renderer: "card", depth: "middle", state: "prepared", project:, source:
      )
    end

    def recency_score(timestamp)
      return 0 unless timestamp

      hours = ((Time.current - timestamp) / 1.hour).clamp(0, 336)
      (40 * (1 - (hours / 336.0))).round
    end

    def assign_depth(items)
      items.each_with_index.map do |item, index|
        item.with(renderer: index.zero? ? "hero_scene" : "card", depth: index.zero? ? "foreground" : "middle", state: "presented")
      end
    end

    def welcome_item
      Item.new(
        id: "welcome", kind: "scene", intent: "discuss", title: "What deserves your attention?",
        summary: "Tell Flyd what is happening. It will resolve the context and shape the surface around it.",
        priority: 0, renderer: "hero_scene", depth: "foreground", state: "presented", project: nil, source: nil
      )
    end
  end
end
