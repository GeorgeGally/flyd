require "test_helper"
require "tmpdir"

class BackupJobTest < ActiveJob::TestCase
  test "archive includes the database dump and configured attachment storage" do
    calls = []
    success = Struct.new(:success?).new(true)

    Dir.mktmpdir("backup-test") do |root|
      working_dir = File.join(root, "working")
      storage_dir = File.join(root, "media")
      archive_path = File.join(root, "archive.tar.gz")
      FileUtils.mkdir_p([ working_dir, storage_dir ])
      File.write(File.join(working_dir, "database.sql"), "database")
      File.write(File.join(storage_dir, "evidence.bin"), "media")

      previous = ENV["ACTIVE_STORAGE_ROOT"]
      ENV["ACTIVE_STORAGE_ROOT"] = storage_dir
      Open3.stub(:capture3, ->(*args) { calls << args; [ "", "", success ] }) do
        error = BackupJob.new.send(:create_archive, archive_path, working_dir)
        assert_nil error
      end
    ensure
      ENV["ACTIVE_STORAGE_ROOT"] = previous
    end

    command = calls.first
    assert_equal "tar", command.first
    assert_includes command, "database.sql"
    assert_includes command, "media"
  end
end
