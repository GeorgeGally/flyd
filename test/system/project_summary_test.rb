require "application_system_test_case"

class ProjectSummaryTest < ApplicationSystemTestCase
  test "summary shows conversation history" do
    project = Project.create!(name: "Summary Project")
    c1 = Conversation.start!(project)
    c1.messages.create!(role: "user", content: "First conversation message")
    c1.archive!
    c2 = Conversation.start!(project)
    c2.messages.create!(role: "user", content: "Active conversation message")

    visit project_path(project)
    assert_text "Active conversation message"
    assert_text "First conversation message"
    assert_text "Active"
    assert_text "Archived"
  end

  test "summary shows decisions" do
    project = Project.create!(name: "Decisions Summary")
    conversation = Conversation.start!(project)
    conversation.decisions.create!(project: project, content: "Chose PostgreSQL over MySQL")

    visit project_path(project)
    assert_text "Chose PostgreSQL over MySQL"
  end
end
