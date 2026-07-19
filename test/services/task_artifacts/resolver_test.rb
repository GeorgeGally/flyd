require "test_helper"

class TaskArtifacts::ResolverTest < ActiveSupport::TestCase
  setup do
    @repository = Dir.mktmpdir("flyd-artifacts")
    project = Project.create!(name: "Artifact resolver #{SecureRandom.hex(4)}", root_path: @repository)
    @task = project.agent_tasks.create!(intended_outcome: "Deliver verified artifacts")
  end

  teardown do
    FileUtils.remove_entry(@repository) if File.exist?(@repository)
  end

  test "resolves verified text only when its retained digest matches" do
    content = "diff --git a/a b/a\n"
    artifact = create_artifact(
      kind: "diff",
      media_type: "text/x-diff",
      content: content,
      sha256_digest: Digest::SHA256.hexdigest(content),
      provenance: { "retained_sha256_digest" => Digest::SHA256.hexdigest(content) }
    )

    resolved = TaskArtifacts::Resolver.call(artifact)

    assert_equal content, resolved.content
    assert_equal "inline", resolved.disposition

    artifact.provenance["retained_sha256_digest"] = "0" * 64
    assert_raises(TaskArtifacts::Resolver::ResolutionError) do
      TaskArtifacts::Resolver.call(artifact)
    end
  end

  test "rejects unverified artifacts and symlink escapes" do
    rejected = create_artifact(verification_status: "rejected", content: "worker claim")
    assert_raises(TaskArtifacts::Resolver::ResolutionError) do
      TaskArtifacts::Resolver.call(rejected)
    end

    outside = Tempfile.new("outside")
    outside.write("secret")
    outside.close
    File.symlink(outside.path, File.join(@repository, "escape.txt"))
    escaped = create_artifact(
      kind: "document",
      media_type: "text/plain",
      content: nil,
      relative_path: "escape.txt",
      sha256_digest: Digest::SHA256.file(outside.path).hexdigest,
      repository_head: "head"
    )
    assert_raises(TaskArtifacts::Resolver::ResolutionError) do
      TaskArtifacts::Resolver.call(escaped, repository_head_reader: ->(_root) { "head" })
    end
  ensure
    outside&.unlink
  end

  test "allows only allowlisted images inline and rejects head mismatches" do
    image = "fake png"
    File.binwrite(File.join(@repository, "screen.png"), image)
    artifact = create_artifact(
      kind: "image",
      media_type: "image/png",
      content: nil,
      relative_path: "screen.png",
      sha256_digest: Digest::SHA256.hexdigest(image),
      repository_head: "abc123"
    )

    resolved = TaskArtifacts::Resolver.call(artifact, repository_head_reader: ->(_root) { "abc123" })
    assert_equal "inline", resolved.disposition
    assert_equal "image/png", resolved.media_type

    assert_raises(TaskArtifacts::Resolver::ResolutionError) do
      TaskArtifacts::Resolver.call(artifact, repository_head_reader: ->(_root) { "different" })
    end
  end

  private

  def create_artifact(kind: "log", media_type: "text/plain", content: "output",
    verification_status: "verified", relative_path: nil, repository_head: nil,
    sha256_digest: nil, provenance: {})
    value = content.to_s
    @task.task_artifacts.create!(
      kind: kind,
      title: "Artifact",
      media_type: media_type,
      byte_size: value.bytesize,
      sha256_digest: sha256_digest || Digest::SHA256.hexdigest(value),
      verification_status: verification_status,
      source_revision: @task.revision,
      content: content,
      relative_path: relative_path,
      repository_head: repository_head,
      provenance: provenance
    )
  end
end
