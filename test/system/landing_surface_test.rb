require "application_system_test_case"

class LandingSurfaceTest < ApplicationSystemTestCase
  test "landing shows project context" do
    project = Project.create!(name: "Landing Project")
    conversation = Conversation.start!(project)
    conversation.messages.create!(role: "user", content: "What should we build?")
    conversation.messages.create!(role: "assistant", content: "Let's start with the API layer.")

    visit project_path(project)
    assert_selector "h2", text: "Here's where we are"
    assert_text "What should we build?"
    assert_text "Let's start with the API layer."
    assert_link "Continue"
  end

  test "empty project shows proactive guidance" do
    project = Project.create!(name: "Empty Project")

    visit project_path(project)
    assert_text "Start your first conversation"
    assert_link "New Conversation"
  end

  test "landing shows recent decisions" do
    project = Project.create!(name: "Decisions Test")
    conversation = Conversation.start!(project)
    conversation.decisions.create!(project: project, content: "Use PostgreSQL for the primary database")

    visit project_path(project)
    assert_text "Use PostgreSQL for the primary database"
  end
end
