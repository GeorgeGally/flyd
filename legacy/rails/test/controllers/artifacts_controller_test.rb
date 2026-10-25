require "test_helper"

class ArtifactsControllerTest < ActionDispatch::IntegrationTest
  test "shows a persisted artifact" do
    scene = Scene.create!(scene_key: "artifact:plan", kind: "work", status: "resolved", title: "Plan the work")
    artifact = scene.artifacts.create!(
      kind: "plan",
      status: "ready",
      title: "Interface plan",
      content: "Remove the project-first shell and render the directed surface."
    )

    get artifact_path(artifact)

    assert_response :success
    assert_select "h1", text: artifact.title
    assert_select "pre", text: artifact.content
  end
end
