require "application_system_test_case"

class ChatStreamingTest < ApplicationSystemTestCase
  setup do
    @project = Project.create!(name: "Chat Project")
    @conversation = Conversation.start!(@project)
  end

  test "chat page renders with message input" do
    visit project_conversation_path(@project, @conversation)
    assert_selector "h2", text: "Chat Project"
    assert_selector "textarea[data-chat-target='input']"
    assert_selector "button", text: "Send"
  end

  test "empty state shows prompt" do
    visit project_conversation_path(@project, @conversation)
    assert_text "Start a conversation"
  end

  test "user message appears optimistically" do
    visit project_conversation_path(@project, @conversation)

    textarea = find("textarea[data-chat-target='input']")
    textarea.fill_in with: "Hello, this is a test message"
    find("button[type='submit']").click

    assert_text "Hello, this is a test message"
  end

  test "command enter submits the message" do
    visit project_conversation_path(@project, @conversation)

    textarea = find("textarea[data-chat-target='input']")
    textarea.fill_in with: "Send this with the keyboard"
    page.execute_script(<<~JS)
      document.querySelector("textarea[data-chat-target='input']").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true })
      )
    JS

    assert_text "Send this with the keyboard"
    assert_equal "", textarea.value
  end

  test "start new chat navigates away" do
    visit project_conversation_path(@project, @conversation)
    click_on "Start New Chat"
    assert_selector "h2", text: "Chat Project"
  end
end
