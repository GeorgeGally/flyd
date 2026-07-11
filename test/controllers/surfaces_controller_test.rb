require "test_helper"

class SurfacesControllerTest < ActionDispatch::IntegrationTest
  setup do
    Surface.delete_all
    @surface = Surface.fallback!
  end

  test "root renders the persisted intelligence surface without calling the model" do
    Flyd::Intelligence.stub(:compose_surface, ->(*) { flunk "GET / must not compose a surface synchronously" }) do
      get root_url
    end

    assert_response :success
    assert_select "textarea[placeholder='Ask, tell, show…']"
    assert_select "h2", text: "What deserves your attention?"
    assert_select "aside", count: 0
  end

  test "surface can embed an active conversation" do
    project = Project.create!(name: "Flyd")
    conversation = Conversation.start!(project)
    conversation.messages.create!(role: "user", content: "Keep this on the surface")

    get root_url(conversation_id: conversation.id)

    assert_response :success
    assert_select "[data-chat-conversation-id-value='#{conversation.id}']"
    assert_select "form[action='#{project_conversation_messages_path(project, conversation)}']"
  end
end
