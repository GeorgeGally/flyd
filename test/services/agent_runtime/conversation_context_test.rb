require "test_helper"
require "tmpdir"

class AgentRuntime::ConversationContextTest < ActiveSupport::TestCase
  test "describes current repository and task truth for conversation" do
    project = Project.create!(name: "Flyd runtime", root_path: Rails.root.to_s)
    task = AgentTask.create!(
      project: project,
      intended_outcome: "Make Flyd usable as a daily driver",
      status: "ready",
      recommended_next_action: "Repair conversational startup"
    )
    git_reader = ->(_root) {
      {
        branch: "main",
        head: "bcb0399",
        dirty_files: 19,
        latest_commit: "fix(runtime): settle local reviews and timestamps"
      }
    }

    prompt = AgentRuntime::ConversationContext.new(task:, git_reader:).to_prompt

    assert_includes prompt, "Make Flyd usable as a daily driver"
    assert_includes prompt, "Repair conversational startup"
    assert_includes prompt, "19 uncommitted changes"
    assert_includes prompt, "fix(runtime): settle local reviews and timestamps"
    assert_includes prompt, "Current repository and task evidence outranks archival memory"
  end

  test "returns no context when no meaningful task exists" do
    assert_nil AgentRuntime::ConversationContext.new(task: nil).to_prompt
  end

  test "describes the repository even when the project has no task" do
    project = Project.create!(name: "Fresh project", root_path: Rails.root.to_s)
    git_reader = ->(_root) {
      {
        branch: "main",
        head: "abc123",
        dirty_files: 0,
        latest_commit: "Initial project setup"
      }
    }

    prompt = AgentRuntime::ConversationContext.call(owner: project, git_reader:)

    assert_includes prompt, "Fresh project"
    assert_includes prompt, "Initial project setup"
    assert_includes prompt, "Working tree: clean"
    refute_includes prompt, "Recent task:"
  end

  test "uses only the owning project's task for a project conversation" do
    current_project = Project.create!(name: "Current project")
    other_project = Project.create!(name: "Other project")
    current_task = AgentTask.create!(
      project: current_project,
      intended_outcome: "Repair this project",
      status: "completed"
    )
    AgentTask.create!(
      project: other_project,
      intended_outcome: "Unrelated unfinished work",
      status: "ready"
    )

    prompt = AgentRuntime::ConversationContext.call(
      owner: current_project,
      git_reader: ->(_root) { {} }
    )

    assert_equal current_task.intended_outcome, "Repair this project"
    assert_includes prompt, "Repair this project"
    refute_includes prompt, "Unrelated unfinished work"
  end

  test "git reader kills a command that exceeds its total budget" do
    Dir.mktmpdir do |directory|
      executable = File.join(directory, "slow-git")
      File.write(executable, "#!/bin/sh\nsleep 2\n")
      FileUtils.chmod(0o755, executable)
      reader = AgentRuntime::ConversationContext::GitReader.new(
        executable:,
        timeout: 0.05
      )
      started_at = Process.clock_gettime(Process::CLOCK_MONOTONIC)

      assert_equal({}, reader.call(Rails.root.to_s))
      elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started_at
      assert_operator elapsed, :<, 0.5
    end
  end
end
