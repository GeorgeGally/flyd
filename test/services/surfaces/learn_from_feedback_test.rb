require "test_helper"

class Surfaces::LearnFromFeedbackTest < ActiveSupport::TestCase
  test "learns soft positive and negative preferences from outcomes" do
    surface = Surface.fallback!
    item = surface.items.first

    useful = SurfaceFeedback.create!(surface: surface, surface_item: item, signal: "useful")
    Surfaces::LearnFromFeedback.call(useful)

    preference = SurfacePreference.find_by!(dimension: "renderer", value: item.renderer)
    assert_operator preference.weight, :>, 0
    assert_equal 1, preference.positive_count

    dismissed = SurfaceFeedback.create!(surface: surface, surface_item: item, signal: "dismissed")
    Surfaces::LearnFromFeedback.call(dismissed)

    assert_equal 1, preference.reload.negative_count
    assert_operator preference.weight, :<, 1
  end
end
