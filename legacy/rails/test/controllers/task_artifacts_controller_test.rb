require "test_helper"

class TaskArtifactsControllerTest < ActionDispatch::IntegrationTest
  test "serves verified text by stable key and hides rejected artifacts" do
    project = Project.create!(name: "Artifact controller #{SecureRandom.hex(4)}", root_path: Dir.home)
    task = project.agent_tasks.create!(intended_outcome: "Inspect evidence")
    content = "verified output"
    verified = task.task_artifacts.create!(
      kind: "test",
      title: "Test output",
      media_type: "text/plain",
      byte_size: content.bytesize,
      sha256_digest: Digest::SHA256.hexdigest(content),
      verification_status: "verified",
      source_revision: task.revision,
      content: content
    )
    rejected = task.task_artifacts.create!(
      kind: "log",
      title: "Rejected output",
      media_type: "text/plain",
      byte_size: 3,
      sha256_digest: Digest::SHA256.hexdigest("bad"),
      verification_status: "rejected",
      source_revision: task.revision,
      content: "bad"
    )

    get task_artifact_path(verified.artifact_key)
    assert_response :success
    assert_equal content, response.body

    get task_artifact_path(rejected.artifact_key)
    assert_response :not_found
  end
end
