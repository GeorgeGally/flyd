require "test_helper"

class ProjectTest < ActiveSupport::TestCase
  test "creates a valid project" do
    project = Project.new(name: "Test Project", description: "A test project")
    assert project.valid?
  end

  test "requires a name" do
    project = Project.new
    assert_not project.valid?
    assert_includes project.errors[:name], "can't be blank"
  end

  test "active scope excludes archived projects" do
    active = Project.create!(name: "Active")
    archived = Project.create!(name: "Archived", archived_at: Time.current)

    assert_includes Project.active, active
    assert_not_includes Project.active, archived
  end

  test "archived scope includes only archived projects" do
    Project.create!(name: "Active")
    archived = Project.create!(name: "Archived", archived_at: Time.current)

    assert_equal [ archived ], Project.archived.to_a
  end

  test "by_recent_activity orders by most recent conversation" do
    older_project = Project.create!(name: "Older")
    newer_project = Project.create!(name: "Newer")

    older_project.conversations.create!(status: "active", updated_at: 1.day.ago)
    newer_project.conversations.create!(status: "active", updated_at: 1.hour.ago)

    ordered = Project.active.by_recent_activity.to_a
    assert_equal newer_project, ordered.first
    assert_equal older_project, ordered.second
  end

  test "archive! sets archived_at" do
    project = Project.create!(name: "To Archive")
    assert_nil project.archived_at

    project.archive!
    assert_not_nil project.archived_at
    assert project.archived?
  end

  test "reactivate! clears archived_at" do
    project = Project.create!(name: "To Reactivate", archived_at: Time.current)
    assert project.archived?

    project.reactivate!
    assert_nil project.archived_at
    assert_not project.archived?
  end

  test "last_activity_at returns updated_at" do
    project = Project.create!(name: "Activity")
    assert_equal project.updated_at, project.last_activity_at
  end

  test "last_activity_at uses conversation updated_at when present" do
    project = Project.create!(name: "With Conversation")
    conversation = project.conversations.create!(status: "active", updated_at: 2.hours.ago)
    assert_equal conversation.updated_at, project.last_activity_at
  end

  test "requires unique name" do
    Project.create!(name: "Unique")
    dup = Project.new(name: "Unique")
    assert_not dup.valid?
    assert_includes dup.errors[:name], "has already been taken"
  end

  test "active_conversation returns active conversation" do
    project = Project.create!(name: "Active Conv")
    Conversation.start!(project)
    assert_not_nil project.active_conversation
    assert project.active_conversation.active?
  end

  test "active_conversation returns nil when all conversations archived" do
    project = Project.create!(name: "No Active")
    conversation = Conversation.start!(project)
    conversation.archive!
    assert_nil project.active_conversation
  end
end
