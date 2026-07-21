module RuntimeTasks
  class NextAction
    WORKER_HEALTH_BLOCKER = /^No healthy worker satisfies:/
    REPOSITORY_INVALIDATED_ASSIGNMENT = "Current repository evidence invalidated the assignment base"
    NO_FOLLOW_UP = /\Ano unresolved\b/i

    def self.call(task)
      next_action = task.recommended_next_action.to_s.strip
      return if next_action.blank?
      return "Worker routing is unavailable; Flyd needs to recover or replace its worker before continuing." if next_action.match?(WORKER_HEALTH_BLOCKER)
      return "The repository changed while work was running; Flyd needs to re-check the current files before continuing." if next_action == REPOSITORY_INVALIDATED_ASSIGNMENT

      next_action
    end

    # A completed task holds the stage only while genuine follow-up remains.
    # "No unresolved..." re-entry notes are terminal: the outcome is returned
    # and the surface should move on to the present situation.
    def self.follow_up?(recommended_next_action)
      next_action = recommended_next_action.to_s.strip
      next_action.present? && !next_action.match?(NO_FOLLOW_UP)
    end

    def self.settled?(status:, recommended_next_action:)
      status.to_s == "completed" && !follow_up?(recommended_next_action)
    end
  end
end
