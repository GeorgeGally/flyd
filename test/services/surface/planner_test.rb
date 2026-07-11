require "test_helper"

class Surface::PlannerTest < ActiveSupport::TestCase
  test "creates a focused semantic surface from remembered state" do
    project = Project.create!(name: "Flyd", description: "Personal intelligence")
    conversation = Conversation.start!(project)
    message = conversation.messages.create!(role: "user", content: "The interface has regressed")
    decision = project.decisions.create!(conversation:, source_message: message, content: "Replace project-first navigation", confidence: 0.9)

    surface = Surface::Planner.call

    assert_equal "decision-#{decision.id}", surface.focus_item_id
    assert_equal "hero_scene", surface.items.first.renderer
    assert_equal "review", surface.items.first.intent
    assert_equal project, surface.items.first.project
  end
end
