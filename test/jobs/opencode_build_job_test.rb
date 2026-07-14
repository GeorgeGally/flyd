require "test_helper"

class OpencodeBuildJobTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "Build Test #{Time.now.to_i}")
    @conversation = Conversation.start!(@project)
    @conversation.messages.create!(role: "user", content: "Add user authentication")
    @build = @project.builds.create!(conversation: @conversation, status: "pending")
  end

  test "execute_opencode returns error when opencode binary not found" do
    job = OpencodeBuildJob.new
    orig_path = ENV["PATH"]
    ENV["PATH"] = "/dev/null"

    result = job.send(:execute_opencode, "test input", "test context", nil)
    assert_equal false, result[:success]
    assert result[:error].present?
  ensure
    ENV["PATH"] = orig_path if orig_path
  end

  test "approved_context includes project info" do
    job = OpencodeBuildJob.new
    context = job.send(:approved_context, @build)
    assert_includes context, @project.name
    assert_includes context, @conversation.messages.last.content
  end

  test "execute_opencode stops after the execution deadline" do
    job = OpencodeBuildJob.new

    Timeout.stub(:timeout, ->(*) { raise Timeout::Error }) do
      result = job.send(:execute_opencode, "test", "context", nil)
      assert_not result[:success]
      assert_match(/timed out/, result[:error])
    end
  end

  test "execute_opencode uses project root_path when available" do
    @project.update!(root_path: Dir.home)
    job = OpencodeBuildJob.new
    orig_path = ENV["PATH"]
    ENV["PATH"] = "/dev/null"

    result = job.send(:execute_opencode, "test", "context", @project.root_path)
    assert_equal false, result[:success]
  ensure
    ENV["PATH"] = orig_path if orig_path
  end
end
