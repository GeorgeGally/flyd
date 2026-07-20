require "test_helper"

class ContextTest < ActiveSupport::TestCase
  test "personal always returns the same context" do
    first = Context.personal
    second = Context.personal

    assert_equal first, second
    assert_equal 1, Context.where(kind: "topic", name: "Personal").count
  end
end
