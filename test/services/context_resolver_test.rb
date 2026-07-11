require "test_helper"

class ContextResolverTest < ActiveSupport::TestCase
  test "resolves a project from strong remembered context" do
    flyd = Project.create!(name: "Flyd", description: "Personal intelligence interface")
    other = Project.create!(name: "Market", description: "Community event")
    flyd.beliefs.create!(statement: "The interface is the intelligence expressed", confidence: 0.9)

    result = ContextResolver.call(text: "The Flyd interface has become a chat app")

    assert_equal flyd, result.project
    assert_operator result.confidence, :>=, ContextResolver::AUTO_ROUTE_THRESHOLD
    assert_not result.requires_confirmation
    assert_not_equal other, result.project
  end

  test "holds ambiguous input outside project memory" do
    Project.create!(name: "Flyd", description: "Personal intelligence interface")
    Project.create!(name: "Market", description: "Community event")

    result = ContextResolver.call(text: "continue")

    assert_nil result.project
    assert result.requires_confirmation
  end

  test "honours active surface context" do
    project = Project.create!(name: "Good Neighbours")

    result = ContextResolver.call(text: "continue", preferred_project_id: project.id)

    assert_equal project, result.project
    assert_equal 1.0, result.confidence
    assert_not result.requires_confirmation
  end
end
