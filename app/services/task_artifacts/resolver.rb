require "open3"

module TaskArtifacts
  class Resolver
    ResolutionError = Class.new(StandardError)
    TEXT_KINDS = %w[diff test log code].freeze
    MAX_FILE_BYTES = 25.megabytes

    Resolved = Data.define(:artifact, :content, :path, :media_type, :filename, :disposition)

    def self.call(artifact, repository_head_reader: nil)
      new(artifact, repository_head_reader:).call
    end

    def initialize(artifact, repository_head_reader: nil)
      @artifact = artifact
      @repository_head_reader = repository_head_reader || method(:repository_head)
    end

    def call
      raise ResolutionError, "Artifact is not verified" unless @artifact.verified?

      @artifact.content.nil? ? resolve_path : resolve_content
    end

    private

    def resolve_content
      raise ResolutionError, "Artifact content cannot be rendered inline" unless TEXT_KINDS.include?(@artifact.kind)

      content = @artifact.content.b
      expected = @artifact.provenance["retained_sha256_digest"].presence || @artifact.sha256_digest
      expected_size = @artifact.provenance["retained_bytes"].presence || @artifact.byte_size
      raise ResolutionError, "Artifact byte size does not match" unless content.bytesize == expected_size

      verify_digest!(content, expected)
      Resolved.new(
        artifact: @artifact,
        content: content,
        path: nil,
        media_type: safe_text_media_type,
        filename: safe_filename,
        disposition: "inline"
      )
    end

    def resolve_path
      raise ResolutionError, "Artifact file is unavailable" if @artifact.relative_path.blank?

      root = Pathname(@artifact.agent_task.project.root_path).realpath
      path = root.join(@artifact.relative_path).realpath
      unless path == root || path.to_s.start_with?("#{root}#{File::SEPARATOR}")
        raise ResolutionError, "Artifact path escapes the repository"
      end

      expected_head = @artifact.repository_head.to_s
      if expected_head.present? && @repository_head_reader.call(root.to_s) != expected_head
        raise ResolutionError, "Artifact repository revision no longer matches"
      end

      size = path.size
      raise ResolutionError, "Artifact file is too large" if size > MAX_FILE_BYTES
      raise ResolutionError, "Artifact byte size does not match" unless size == @artifact.byte_size

      content = path.binread
      verify_digest!(content, @artifact.sha256_digest)
      disposition = @artifact.inline_image? ? "inline" : "attachment"
      Resolved.new(
        artifact: @artifact,
        content: content,
        path: nil,
        media_type: disposition == "inline" ? @artifact.media_type : "application/octet-stream",
        filename: safe_filename(path.basename.to_s),
        disposition: disposition
      )
    rescue Errno::ENOENT, Errno::EACCES => error
      raise ResolutionError, "Artifact file is unavailable: #{error.message}"
    end

    def verify_digest!(content, expected)
      actual = Digest::SHA256.hexdigest(content)
      raise ResolutionError, "Artifact digest does not match" unless ActiveSupport::SecurityUtils.secure_compare(actual, expected)
    end

    def safe_text_media_type
      @artifact.media_type.start_with?("text/") ? @artifact.media_type : "text/plain"
    end

    def safe_filename(fallback = nil)
      raw = fallback.presence || "#{@artifact.kind}-#{@artifact.artifact_key}.txt"
      File.basename(raw).gsub(/[^A-Za-z0-9._-]/, "_")
    end

    def repository_head(root)
      stdout, _stderr, status = Open3.capture3("git", "-C", root, "rev-parse", "HEAD")
      raise ResolutionError, "Artifact repository revision is unavailable" unless status.success?

      stdout.strip
    end
  end
end
