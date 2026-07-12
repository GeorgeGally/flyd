require "test_helper"

class ContextResolverTest < ActiveSupport::TestCase
  test "resolves a project only from uniquely strong remembered context" do
    flyd = Project.create!(name: "Flyd", description: "Personal intelligence interface")
    other = Project.create!(name: "Market", description: "Community event")
    flyd.beliefs.create!(statement: "The interface is the intelligence expressed", confidence: 0.9)

    result = ContextResolver.call(text: "The Flyd interface has become a chat app")

    assert_equal flyd, result.project
    assert_operator result.confidence, :>=, ContextResolver::AUTO_ROUTE_THRESHOLD
    assert_not result.requires_confirmation
    assert_not_equal other, result.project
  end

  test "holds generic overlap outside project memory" do
    Project.create!(name: "Flyd", description: "Personal intelligence interface planning")
    Project.create!(name: "Market", description: "Community planning event")

    result = ContextResolver.call(text: "continue planning")

    assert result.requires_confirmation
  end

  test "requires confirmation when top candidates are tied" do
    Project.create!(name: "Alpha", description: "Launch planning")
    Project.create!(name: "Beta", description: "Launch planning")

    result = ContextResolver.call(text: "launch planning")

    assert result.requires_confirmation
    assert_operator result.candidates.length, :>=, 2
  end

  test "resolves a temporary context as a first-class owner" do
    context = Context.create!(name: "Interface sprint", description: "Short-lived spatial interface work")

    result = ContextResolver.call(text: "Continue the Interface sprint")

    assert_equal context, result.context
    assert_equal context, result.owner
    assert_not result.requires_confirmation
  end

  test "honours explicit active surface project context" do
    project = Project.create!(name: "Good Neighbours")

    result = ContextResolver.call(text: "continue", preferred_project_id: project.id)

    assert_equal project, result.project
    assert_equal 1.0, result.confidence
    assert_not result.requires_confirmation
  end
end
