require "timeout"

module AgentRuntime
  class ConversationContext
    GIT_TIMEOUT = 0.5

    class GitReader
      def initialize(executable: "git", timeout: GIT_TIMEOUT)
        @executable = executable
        @timeout = timeout
      end

      def call(root)
        return {} if root.blank? || !Pathname(root).directory?

        deadline = monotonic_time + @timeout
        status = capture(root, %w[status --porcelain=v2 --branch], deadline)
        latest_commit = capture(root, %w[log -1 --pretty=%s], deadline)
        branch = status.lines.find { |line| line.start_with?("# branch.head ") }&.delete_prefix("# branch.head ")
        head = status.lines.find { |line| line.start_with?("# branch.oid ") }&.delete_prefix("# branch.oid ")
        {
          branch: branch&.strip,
          head: head&.strip&.first(12),
          dirty_files: status.lines.count { |line| !line.start_with?("#") },
          latest_commit: latest_commit.strip
        }
      rescue StandardError
        {}
      end

      private

      def capture(root, arguments, deadline)
        reader, writer = IO.pipe
        pid = Process.spawn(
          @executable,
          "-C",
          root,
          *arguments,
          out: writer,
          err: File::NULL,
          pgroup: true
        )
        writer.close
        output = +""

        loop do
          remaining = deadline - monotonic_time
          raise Timeout::Error, "Git context timed out" unless remaining.positive?
          raise Timeout::Error, "Git context timed out" unless IO.select([reader], nil, nil, remaining)

          output << reader.read_nonblock(16.kilobytes)
        rescue IO::WaitReadable
          next
        rescue EOFError
          break
        end

        remaining = deadline - monotonic_time
        raise Timeout::Error, "Git context timed out" unless remaining.positive?
        _, status = wait_for(pid, remaining)
        pid = nil
        raise "Git context command failed" unless status.success?

        output
      ensure
        reader&.close
        writer&.close
        terminate(pid) if pid
      end

      def wait_for(pid, timeout)
        deadline = monotonic_time + timeout
        loop do
          result = Process.waitpid2(pid, Process::WNOHANG)
          return result if result
          raise Timeout::Error, "Git context timed out" if monotonic_time >= deadline

          sleep 0.005
        end
      end

      def terminate(pid)
        Process.kill("TERM", -pid)
        wait_for(pid, 0.05)
      rescue Timeout::Error
        Process.kill("KILL", -pid)
        Process.waitpid(pid)
      rescue Errno::ESRCH, Errno::ECHILD
        nil
      end

      def monotonic_time
        Process.clock_gettime(Process::CLOCK_MONOTONIC)
      end
    end

    def self.call(owner:, git_reader: nil)
      tasks = owner.is_a?(Project) ? owner.agent_tasks : AgentTask.all
      task = tasks.unfinished.recent.first ||
        tasks.where.not(status: "cancelled").recent.first
      repository_root = if owner.is_a?(Project)
        owner.root_path
      else
        task&.project&.root_path.presence || Rails.root.to_s
      end
      project_name = task&.project&.name || (owner.name if owner.is_a?(Project)) || File.basename(repository_root)
      new(task:, repository_root:, project_name:, git_reader:).to_prompt
    end

    def initialize(task:, repository_root: nil, project_name: nil, git_reader: nil)
      @task = task
      @repository_root = repository_root || task&.project&.root_path
      @project_name = project_name || task&.project&.name
      @git_reader = git_reader || GitReader.new
    end

    def to_prompt
      return if @task.nil? && @repository_root.blank?

      repository = @git_reader.call(@repository_root)
      working_tree = if repository[:dirty_files].to_i.positive?
        "#{repository[:dirty_files]} uncommitted changes"
      else
        "clean"
      end
      task_lines = if @task
        <<~TASK
          - Recent task: #{@task.intended_outcome}
          - Task status: #{@task.status}
          - Next move: #{@task.recommended_next_action.presence || "not recorded"}
        TASK
      end

      <<~PROMPT

        ## Current Flyd work
        Current repository and task evidence outranks archival memory, especially for questions about current or recent work.
        - Project: #{@project_name.presence || "unknown"}
        - Branch: #{repository[:branch].presence || "unknown"}
        - HEAD: #{repository[:head].presence || "unknown"}
        - Working tree: #{working_tree}
        - Latest commit: #{repository[:latest_commit].presence || "unknown"}
        #{task_lines}
      PROMPT
    end

  end
end
