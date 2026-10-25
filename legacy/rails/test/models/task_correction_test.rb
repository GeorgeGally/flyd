require "test_helper"

class TaskCorrectionTest < ActiveSupport::TestCase
  test "preserves a user-authoritative correction and supersession chain" do
    project = Project.create!(name: "Correction #{SecureRandom.hex(4)}", root_path: Dir.home)
    task = project.agent_tasks.create!(intended_outcome: "Remember corrections")
    first = task.task_corrections.create!(
      original_claim: "The user is Aries",
      corrected_value: "The user is not Aries",
      task_revision: 1,
      surface_revision: 12,
      provenance: { "actor_surface" => "rails" }
    )
    second = task.task_corrections.create!(
      supersedes_task_correction: first,
      original_claim: "The user is not Aries",
      corrected_value: "Use the configured birth data",
      task_revision: 2,
      provenance: { "actor_surface" => "cli" }
    )

    assert first.readonly?
    assert_equal first, second.supersedes_task_correction
    assert_equal "user", second.authority
  end
end
