require "test_helper"

class ReleaseMarkerTest < ActiveSupport::TestCase
  test "identifies one persisted availability boundary per release" do
    marker = ReleaseMarker.create!(release_key: "release_1c_test", available_at: Time.current)

    assert_equal marker, ReleaseMarker.find_by!(release_key: "release_1c_test")
    assert_not ReleaseMarker.new(release_key: "", available_at: nil).valid?
  end
end
