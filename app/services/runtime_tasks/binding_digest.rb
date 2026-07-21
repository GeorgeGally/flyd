module RuntimeTasks
  class BindingDigest
    def self.call(task:, item:)
      binding = BindingPresenter.call(item)
      raise BindingPresenter::BindingError, "Runtime digest task does not match its item" unless binding.task == task

      payload = {
        task_key: task.task_key,
        task_revision: task.revision,
        workers: binding.workers.sort_by(&:worker_key).map do |worker|
          worker.attributes.slice("worker_key", "status", "adapter", "external_session_id", "exit_status")
        end,
        artifacts: binding.artifacts.sort_by(&:artifact_key).map do |artifact|
          artifact.attributes.slice("artifact_key", "kind", "verification_status", "sha256_digest", "source_revision")
        end,
        actions: Array(item.actions).map { |action| action.to_h.deep_stringify_keys }
          .sort_by { |action| action.fetch("id", "") }
      }

      Digest::SHA256.hexdigest(JSON.generate(payload))
    end
  end
end
