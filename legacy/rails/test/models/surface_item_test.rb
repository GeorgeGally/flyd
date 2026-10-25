require "test_helper"

class SurfaceItemTest < ActiveSupport::TestCase
  test "renderer capabilities come from the renderer registry" do
    assert_equal SurfaceRenderers::Registry.ids.sort, SurfaceItem::RENDERERS.sort
    assert_equal SurfaceRenderers::Registry.kinds.sort, SurfaceItem::KINDS.sort
  end
end
