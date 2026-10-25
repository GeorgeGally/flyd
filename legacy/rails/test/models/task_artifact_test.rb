require "test_helper"

class TaskArtifactTest < ActiveSupport::TestCase
  setup do
    project = Project.create!(name: "Artifact project #{SecureRandom.hex(4)}", root_path: Dir.home)
    @task = project.agent_tasks.create!(intended_outcome: "Retain verified evidence")
  end

  test "accepts a bounded verified text artifact" do
    content = "diff --git a/app.rb b/app.rb\n"
    artifact = @task.task_artifacts.create!(
      kind: "diff",
      title: "Verified patch",
      media_type: "text/x-diff",
      byte_size: content.bytesize,
      sha256_digest: Digest::SHA256.hexdigest(content),
      verification_status: "verified",
      source_revision: @task.revision,
      content:,
      provenance: { "repository_head" => "abc123" }
    )

    assert artifact.persisted?
    assert artifact.readonly?
  end

  test "rejects traversal, invalid digests, and cross-task owners" do
    artifact = @task.task_artifacts.new(
      kind: "document",
      title: "Unsafe file",
      media_type: "application/pdf",
      byte_size: 10,
      sha256_digest: "not-a-digest",
      verification_status: "verified",
      source_revision: @task.revision,
      relative_path: "../secret.pdf"
    )

    assert_not artifact.valid?
    assert_includes artifact.errors[:relative_path], "must be repository-relative"
    assert artifact.errors[:sha256_digest].any?
  end

  test "allows inline rendering only for allowlisted verified image types" do
    artifact = @task.task_artifacts.new(
      kind: "image",
      title: "Screenshot",
      media_type: "image/svg+xml",
      byte_size: 0,
      sha256_digest: Digest::SHA256.hexdigest(""),
      verification_status: "verified",
      source_revision: @task.revision
    )

    assert_not artifact.inline_image?
    artifact.media_type = "image/png"
    assert artifact.inline_image?
  end
end
