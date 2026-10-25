require "test_helper"

class ConversationTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "Test Project")
  end

  test "start! creates an active project conversation" do
    conversation = Conversation.start!(@project)
    assert conversation.active?
    assert_equal "active", conversation.status
    assert_equal @project, conversation.project
    assert_nil conversation.context
  end

  test "start! creates an active temporary-context conversation" do
    context = Context.create!(name: "Interface sprint")
    conversation = Conversation.start!(context)

    assert conversation.active?
    assert_equal context, conversation.context
    assert_nil conversation.project
    assert_equal context.name, conversation.owner_name
  end

  test "start! deactivates prior active conversation for the same owner" do
    first = Conversation.start!(@project)
    second = Conversation.start!(@project)

    assert_not first.reload.active?
    assert second.active?
    assert_equal 1, @project.conversations.where(active: true).count
  end

  test "project and temporary context may each have an active conversation" do
    context = Context.create!(name: "Interface sprint")
    project_conversation = Conversation.start!(@project)
    context_conversation = Conversation.start!(context)

    assert project_conversation.active?
    assert context_conversation.active?
  end

  test "conversation requires exactly one owner" do
    context = Context.create!(name: "Interface sprint")

    assert_not Conversation.new(status: "active").valid?
    assert_not Conversation.new(project: @project, context: context, status: "active").valid?
  end

  test "supersede_by! records conversation lineage" do
    first = Conversation.start!(@project)
    second = Conversation.start!(@project)
    first.supersede_by!(second)

    assert_equal "superseded", first.reload.status
    assert_equal second, first.superseded_by_conversation
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
