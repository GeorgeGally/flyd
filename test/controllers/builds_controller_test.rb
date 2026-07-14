require "test_helper"

class BuildsControllerTest < ActionDispatch::IntegrationTest
  test "reverts confirmation when the build cannot be queued" do
    project = Project.create!(name: "Queue test")
    conversation = Conversation.start!(project)
    build = project.builds.create!(
      conversation: conversation,
      status: "proposed",
      instructions: "Implement the approved change"
    )

    OpencodeBuildJob.stub(:perform_later, ->(*) { raise RedisClient::CannotConnectError, "queue unavailable" }) do
      post confirm_build_path(build)
    end

    assert_redirected_to build_path(build)
    assert_equal "proposed", build.reload.status
    assert_nil build.confirmed_at
    assert_equal "The build could not be queued. Try again.", flash[:alert]
  end
end
