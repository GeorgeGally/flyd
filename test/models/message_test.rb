require "test_helper"

class MessageTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "Message Test #{Time.now.to_i}")
    @conversation = Conversation.start!(@project)
  end

  test "creates user message" do
    msg = @conversation.messages.create!(role: "user", content: "Hello")
    assert_equal "user", msg.role
    assert_equal "Hello", msg.content
  end

  test "requires valid role" do
    msg = @conversation.messages.build(role: "invalid", content: "test")
    assert_not msg.valid?
  end

  test "ordered scope returns by created_at" do
    first = @conversation.messages.create!(role: "user", content: "First")
    second = @conversation.messages.create!(role: "assistant", content: "Second")
    assert_equal [first, second], @conversation.messages.ordered.to_a
  end
end
