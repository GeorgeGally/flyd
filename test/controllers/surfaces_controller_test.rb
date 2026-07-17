require "test_helper"

class SurfacesControllerTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  setup do
    Rails.cache.delete(ComposeSurfaceJob::LOCK_KEY)
    Rails.cache.delete(RefreshIntelligenceStateJob::LOCK_KEY)
    Rails.cache.delete(RefreshPersonalContextJob::LOCK_KEY) if defined?(RefreshPersonalContextJob::LOCK_KEY)
    Rails.cache.delete(RefreshWebDiscoveryJob::LOCK_KEY) if defined?(RefreshWebDiscoveryJob::LOCK_KEY)
    Surface.delete_all
    @surface = Surface.fallback!
  end

  test "root renders the persisted intelligence surface without calling the model" do
    Flyd::Intelligence.stub(:compose_surface, ->(*) { flunk "GET / must not compose a surface synchronously" }) do
      get root_url
    end

    assert_response :success
    assert_select "textarea[placeholder='Ask, tell, show…']"
    assert_select "h2", text: "Ready when you are."
    assert_select "aside", count: 0
  end

  test "missing provider state queues refresh and degraded composition without blocking" do
    get root_url

    assert_enqueued_jobs 1, only: RefreshIntelligenceStateJob
    assert_enqueued_jobs 1, only: RefreshPersonalContextJob
    assert_enqueued_jobs 1, only: RefreshWebDiscoveryJob
    assert_enqueued_jobs 1, only: ComposeSurfaceJob
    assert_response :success
  end

  test "fresh provider state queues fallback surface composition" do
    IntelligenceState::CliProvider.new.persist!(provider_payload)

    assert_enqueued_with(job: ComposeSurfaceJob) do
      get root_url
    end

    assert_response :success
  end

  test "queue failure does not prevent the persisted surface from rendering" do
    IntelligenceState::CliProvider.new.persist!(provider_payload)

    ComposeSurfaceJob.stub(:enqueue, ->(**) { raise RedisClient::CannotConnectError, "queue unavailable" }) do
      get root_url
    end

    assert_response :success
    assert_select "h2", text: "Ready when you are."
  end

  test "surface can embed a project conversation" do
    project = Project.create!(name: "Flyd")
    conversation = Conversation.start!(project)
    conversation.messages.create!(role: "user", content: "Keep this on the surface")

    get root_url(conversation_id: conversation.id)

    assert_response :success
    assert_select "[data-chat-conversation-id-value='#{conversation.id}']"
    assert_select "form[action='#{project_conversation_messages_path(project, conversation)}']"
  end

  test "surface can embed a temporary-context conversation" do
    context = Context.create!(name: "Interface sprint")
    conversation = Conversation.start!(context)
    conversation.messages.create!(role: "user", content: "Keep this temporary context active")

    get root_url(conversation_id: conversation.id)

    assert_response :success
    assert_select "[data-chat-conversation-id-value='#{conversation.id}']"
    assert_select "form[action='#{conversation_messages_path(conversation)}']"
    assert_select "span", text: /Current work · Interface sprint/
  end

  test "dismissed and collapsed scene items are not rendered" do
    item = @surface.items.first
    item.update!(state: "dismissed")

    get root_url

    assert_response :success
    assert_select "[data-item-key='#{item.item_key}']", count: 0
  end

  private

  def provider_payload
    {
      "version" => "1.0",
      "generatedAt" => Time.current.iso8601,
      "source" => "flyd-cli",
      "goals" => [],
      "tensions" => [],
      "signals" => [],
      "curiosity" => [],
      "nudges" => [],
      "reports" => [],
      "recentEvents" => [],
      "brainHealth" => [],
      "profile" => [],
      "knowledge" => [],
      "review" => [],
      "suggestions" => [],
      "capabilities" => []
    }
  end
end
