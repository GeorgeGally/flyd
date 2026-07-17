require "test_helper"

class Workers::OpenCodeCommandTest < ActiveSupport::TestCase
  test "builds the same structured new-session contract as the continuity harness" do
    command = Workers::OpenCodeCommand.new(
      assignment: "Implement continuity",
      context_path: "/tmp/context.md",
      project_root: "/work/flyd",
      title: "flyd:task-1"
    )

    assert_equal [
      "opencode", "run", "Implement continuity",
      "-f", "/tmp/context.md",
      "--format", "json",
      "--dir", "/work/flyd",
      "--title", "flyd:task-1",
      "--auto"
    ], command.argv
  end

  test "builds a focused resume without replaying the context file" do
    command = Workers::OpenCodeCommand.new(
      assignment: "Fix the failing migration",
      project_root: "/work/flyd",
      session_id: "ses_1"
    )

    assert_equal [
      "opencode", "run", "Fix the failing migration",
      "--session", "ses_1",
      "--format", "json",
      "--dir", "/work/flyd",
      "--auto"
    ], command.argv
  end

  test "enforces repository-only deny-by-default permissions" do
    command = Workers::OpenCodeCommand.new(
      assignment: "Implement continuity",
      context_path: "/tmp/context.md",
      project_root: "/work/flyd"
    )

    config = JSON.parse(command.environment.fetch("OPENCODE_CONFIG_CONTENT"))
    assert_equal "deny", config.dig("permission", "*")
    assert_equal "deny", config.dig("permission", "external_directory")
    assert_equal "deny", config.dig("permission", "bash", "*")
    assert_equal "allow", config.dig("permission", "bash", "bin/rails test*")
    assert_not command.environment.key?("DATABASE_URL")
    assert_not command.environment.key?("GITHUB_TOKEN")
    assert_not command.environment.key?("OPENAI_API_KEY")
    assert_not command.environment.key?("ANTHROPIC_API_KEY")
    assert_not command.environment.key?("SSH_AUTH_SOCK")
  end
end
