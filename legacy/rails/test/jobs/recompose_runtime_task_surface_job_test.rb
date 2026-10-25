require "test_helper"

class RecomposeRuntimeTaskSurfaceJobTest < ActiveJob::TestCase
  test "recomposes only the current committed revision" do
    project = Project.create!(name: "Recompose runtime #{SecureRandom.hex(4)}", root_path: Dir.home)
    task = project.agent_tasks.create!(intended_outcome: "Recompose phase")
    calls = []

    ComposeSurfaceJob.stub(:enqueue, ->(**arguments) { calls << arguments }) do
      RecomposeRuntimeTaskSurfaceJob.perform_now(task.id, task.revision)
      RecomposeRuntimeTaskSurfaceJob.perform_now(task.id, task.revision + 1)
    end

    assert_equal [ { reason: "runtime_phase_change" } ], calls
  end
end
