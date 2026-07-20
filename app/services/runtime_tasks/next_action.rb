module RuntimeTasks
  class NextAction
    WORKER_HEALTH_BLOCKER = /^No healthy worker satisfies:/
    REPOSITORY_INVALIDATED_ASSIGNMENT = "Current repository evidence invalidated the assignment base"

    def self.call(task)
      next_action = task.recommended_next_action.to_s.strip
      return if next_action.blank?
      return "Worker routing is unavailable; Flyd needs to recover or replace its worker before continuing." if next_action.match?(WORKER_HEALTH_BLOCKER)
      return "The repository changed while work was running; Flyd needs to re-check the current files before continuing." if next_action == REPOSITORY_INVALIDATED_ASSIGNMENT

      next_action
    end
  end
end
