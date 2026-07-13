require "test_helper"

class SurfaceFeedbacksControllerTest < ActionDispatch::IntegrationTest
  setup do
    @surface = Surface.fallback!
    @item = @surface.items.first
  end

  test "dismisses a scene and stores feedback" do
    assert_difference("SurfaceFeedback.count", 1) do
      post surface_item_feedbacks_path(@item), params: { signal: "dismiss" }
    end

    assert_redirected_to root_path
    assert_equal "dismissed", @item.reload.state
    assert_equal "dismissed", SurfaceFeedback.last.signal
  end

  test "resolves and collapses a scene" do
    post surface_item_feedbacks_path(@item), params: { signal: "resolve" }

    assert_equal "collapsed", @item.reload.state
    assert @item.metadata["collapsed_at"].present?
    assert_equal "resolved", SurfaceFeedback.last.signal
  end
end
