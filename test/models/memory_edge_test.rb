require "test_helper"

class MemoryEdgeTest < ActiveSupport::TestCase
  setup do
    @project = Project.create!(name: "Edge Test #{Time.now.to_i}")
    @conversation = Conversation.start!(@project)
    @decision = @project.decisions.create!(conversation: @conversation, content: "Use PostgreSQL", extracted_at: Time.current)
    @related = @project.decisions.create!(conversation: @conversation, content: "Use Redis", extracted_at: Time.current)
    @edge = MemoryEdge.create!(
      source: @decision,
      target: @related,
      confidence: 0.5
    )
  end

  test "creates with polymorphic associations" do
    assert_equal @decision, @edge.source
    assert_equal @related, @edge.target
    assert_in_delta 0.5, @edge.confidence
  end

  test "cite! increments count" do
    assert_changes -> { @edge.reload.citation_count.to_i }, from: 0, to: 1 do
      @edge.cite!
    end
  end

  test "cite! increases confidence" do
    assert_changes -> { @edge.reload.confidence }, from: 0.5 do
      @edge.cite!
    end
  end

  test "cite! caps confidence at 1.0" do
    @edge.update!(confidence: 0.98)
    @edge.cite!
    assert @edge.confidence <= 1.0
  end

  test "decay! reduces confidence" do
    assert_changes -> { @edge.reload.confidence }, from: 0.5 do
      @edge.decay!
    end
  end

  test "decay! floors confidence at 0.1" do
    @edge.update!(confidence: 0.05)
    @edge.decay!
    assert_in_delta 0.1, @edge.confidence
  end
end
