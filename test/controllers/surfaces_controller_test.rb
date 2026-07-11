require "test_helper"

class SurfacesControllerTest < ActionDispatch::IntegrationTest
  test "root renders the intelligence surface without project navigation" do
    Project.create!(name: "Flyd", description: "Personal intelligence")

    get root_url

    assert_response :success
    assert_select "textarea[placeholder='Ask, tell, show…']"
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
