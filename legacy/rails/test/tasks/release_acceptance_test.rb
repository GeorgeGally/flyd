require "test_helper"
require "rake"

class ReleaseAcceptanceTaskTest < ActiveSupport::TestCase
  setup do
    Rails.application.load_tasks unless Rake::Task.task_defined?("flyd:release:mark_1c")
    ReleaseMarker.where(release_key: "release_1c").delete_all
    @original_environment = ENV.to_h.slice("RELEASE_COMMIT", "CONFIRM_NEW_TRIAL")
    ENV.delete("RELEASE_COMMIT")
    ENV.delete("CONFIRM_NEW_TRIAL")
  end

  teardown do
    %w[RELEASE_COMMIT CONFIRM_NEW_TRIAL].each { |key| ENV.delete(key) }
    @original_environment.each { |key, value| ENV[key] = value }
    release_tasks.each(&:reenable)
  end

  test "marks a commit once without silently resetting its trial window" do
    ENV["RELEASE_COMMIT"] = "release-commit-a"
    task = Rake::Task["flyd:release:mark_1c"]

    capture_io { task.invoke }
    original_time = ReleaseMarker.find_by!(release_key: "release_1c").available_at
    task.reenable
    travel 1.hour do
      capture_io { task.invoke }
    end

    marker = ReleaseMarker.find_by!(release_key: "release_1c")
    assert_equal "release-commit-a", marker.metadata.fetch("commit")
    assert_equal original_time, marker.available_at
  end

  test "refuses to replace an existing trial implicitly" do
    ReleaseMarker.create!(
      release_key: "release_1c", available_at: 1.day.ago,
      metadata: { "commit" => "release-commit-a" }
    )
    ENV["RELEASE_COMMIT"] = "release-commit-b"

    error = assert_raises(RuntimeError) do
      capture_io { Rake::Task["flyd:release:mark_1c"].invoke }
    end

    assert_match(/start_new_1c_trial/, error.message)
    assert_equal "release-commit-a", ReleaseMarker.find_by!(release_key: "release_1c").metadata.fetch("commit")
  end

  test "starts a replacement trial only with explicit confirmation" do
    marker = ReleaseMarker.create!(
      release_key: "release_1c", available_at: 1.day.ago,
      metadata: { "commit" => "release-commit-a" }
    )
    ENV["RELEASE_COMMIT"] = "release-commit-b"
    task = Rake::Task["flyd:release:start_new_1c_trial"]

    assert_raises(RuntimeError) { capture_io { task.invoke } }
    task.reenable
    ENV["CONFIRM_NEW_TRIAL"] = "1"
    capture_io { task.invoke }

    marker.reload
    assert_equal "release-commit-b", marker.metadata.fetch("commit")
    assert_operator marker.available_at, :>, 1.hour.ago
  end

  private

  def release_tasks
    %w[flyd:release:mark_1c flyd:release:start_new_1c_trial].map { |name| Rake::Task[name] }
  end
end
