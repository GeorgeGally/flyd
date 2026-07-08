require "test_helper"

class ConversationTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "Test Project")
  end

  test "start! creates active conversation" do
    conversation = Conversation.start!(@project)
    assert conversation.active?
    assert_equal "active", conversation.status
    assert_equal @project, conversation.project
  end

  test "start! deactivates prior active conversation" do
    first = Conversation.start!(@project)
    assert first.active?

    second = Conversation.start!(@project)
    first.reload
    assert_not first.active?
    assert second.active?
  end

  test "only one active conversation per project" do
    c1 = Conversation.start!(@project)
    c2 = Conversation.start!(@project)
    assert_equal 1, @project.conversations.where(active: true).count
  end

  test "archive! sets inactive" do
    conversation = Conversation.start!(@project)
    conversation.archive!
    assert_not conversation.active?
    assert_equal "archived", conversation.status
  end

  test "has many messages" do
    conversation = Conversation.start!(@project)
    conversation.messages.create!(role: "user", content: "Hello")
    conversation.messages.create!(role: "assistant", content: "Hi there")
    assert_equal 2, conversation.messages.count
  end

  test "start! accepts optional summary" do
    conversation = Conversation.start!(@project, summary: "Session summary")
    assert_equal "Session summary", conversation.summary
  end
end
