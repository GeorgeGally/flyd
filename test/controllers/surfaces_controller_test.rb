require "test_helper"

class SurfacesControllerTest < ActionDispatch::IntegrationTest
  setup do
    @surface = Flyd::Intelligence::Surface.new(
      generated_at: Time.current,
      understanding: "A calm default surface",
      current_intention: "Remain available",
      focus_item_id: "continue",
      items: [
        Flyd::Intelligence::SurfaceItem.new(
          id: "continue", kind: "scene", intent: "discuss",
          title: "What deserves your attention?", summary: "Tell Flyd what is happening.",
          renderer: "hero_scene", depth: "foreground", state: "presented",
          context_refs: [], source_refs: [], actions: []
        )
      ]
    )
  end

  test "root renders the intelligence surface without project navigation" do
    Flyd::Intelligence.stub(:compose_surface, @surface) do
      get root_url
    end

    assert_response :success
    assert_select "textarea[placeholder='Ask, tell, show…']"
    assert_select "aside", count: 0
  end

  test "surface can embed an active conversation" do
    project = Project.create!(name: "Flyd")
    conversation = Conversation.start!(project)
    conversation.messages.create!(role: "user", content: "Keep this on the surface")

    Flyd::Intelligence.stub(:compose_surface, @surface) do
      get root_url(conversation_id: conversation.id)
    end

    assert_response :success
    assert_select "[data-chat-conversation-id-value='#{conversation.id}']"
    assert_select "form[action='#{project_conversation_messages_path(project, conversation)}']"
  end
end
