require "test_helper"
require "tmpdir"

class LocalActivity::ScannerTest < ActiveSupport::TestCase
  test "returns recent Git and file activity in descending order" do
    Dir.mktmpdir do |root|
      flyd = File.join(root, "flyd")
      horoscopes = File.join(root, "horoscopes")
      FileUtils.mkdir_p(File.join(flyd, ".git"))
      FileUtils.mkdir_p(horoscopes)
      File.write(File.join(horoscopes, "index.html"), "horoscope")
      modified_at = Time.zone.parse("2026-07-04 10:54").to_time
      File.utime(modified_at, modified_at, File.join(horoscopes, "index.html"))
      runner = lambda do |directory|
        next unless directory == flyd

        {
          updated_at: Time.zone.parse("2026-07-14 18:36"),
          branch: "main",
          summary: "Render grounded discovery posters"
        }
      end

      activities = LocalActivity::Scanner.new(root:, git_reader: runner).fetch

      assert_equal %w[flyd horoscopes], activities.pluck(:name)
      assert_equal "main", activities.first[:branch]
      assert_equal "Render grounded discovery posters", activities.first[:summary]
      assert_equal Time.zone.parse("2026-07-04 10:54"), activities.second[:updated_at]
    end
  end
end
