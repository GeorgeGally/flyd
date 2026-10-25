require "open3"
require "timeout"

module LocalActivity
  class Scanner
    DEFAULT_LIMIT = 12
    GIT_TIMEOUT = 2.seconds

    def initialize(root:, git_reader: nil, limit: DEFAULT_LIMIT, exclude: [])
      @root = Pathname(root).expand_path
      @git_reader = git_reader || method(:git_activity)
      @limit = limit
      @excluded = Array(exclude).map { |path| Pathname(path).expand_path }
    end

    def fetch
      return [] unless @root.directory?

      @root.children.select(&:directory?).reject { |directory| excluded?(directory) }
        .filter_map { |directory| activity_for(directory) }
        .sort_by { |activity| -activity.fetch(:updated_at).to_f }
        .first(@limit)
    end

    private

    def excluded?(directory)
      @excluded.any? { |path| directory.expand_path == path }
    end

    def activity_for(directory)
      details = if directory.join(".git").directory?
        @git_reader.call(directory.to_s)
      else
        file_activity(directory)
      end
      return unless details&.dig(:updated_at)

      details.merge(name: directory.basename.to_s, path: directory.to_s)
    rescue Errno::EACCES, Errno::ENOENT
      nil
    end

    def file_activity(directory)
      modified = directory.children.reject { |path| path.basename.to_s.start_with?(".") }
        .select(&:file?).filter_map { |path| path.mtime rescue nil }.max
      { updated_at: modified } if modified
    end

    def git_activity(directory)
      Timeout.timeout(GIT_TIMEOUT) do
        log, log_error, log_status = Open3.capture3("git", "-C", directory, "log", "-1", "--format=%cI%x00%s")
        raise log_error unless log_status.success?

        timestamp, summary = log.strip.split("\0", 2)
        branch, = Open3.capture2("git", "-C", directory, "branch", "--show-current")
        {
          updated_at: Time.zone.parse(timestamp),
          branch: branch.strip.presence,
          summary: summary.to_s.squish.presence
        }.compact
      end
    rescue StandardError
      file_activity(Pathname(directory))
    end
  end
end
