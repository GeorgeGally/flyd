module Builds
  class Propose
    ACTIVE_STATUSES = %w[proposed pending preparing running].freeze

    def self.call(project:, conversation:, scene: nil, surface_item: nil, instructions: nil)
      new(
        project: project,
        conversation: conversation,
        scene: scene,
        surface_item: surface_item,
        instructions: instructions
      ).call
    end

    def initialize(project:, conversation:, scene:, surface_item:, instructions:)
      @project = project
      @conversation = conversation
      @scene = scene || conversation.primary_scene
      @surface_item = surface_item
      @instructions = instructions.to_s.strip
    end

    def call
      existing = @project.builds.where(status: ACTIVE_STATUSES).order(created_at: :desc).first
      return existing if existing

      instructions = resolved_instructions
      @project.builds.create!(
        conversation: @conversation,
        scene: @scene,
        requested_by_surface_item: @surface_item,
        status: "proposed",
        instructions: instructions,
        confirmation_summary: confirmation_summary(instructions),
        context_snapshot: context_snapshot
      )
    end

    private

    def resolved_instructions
      @instructions.presence ||
        @scene&.desired_outcome.presence ||
        @conversation.visible_messages.reverse.find { |message| message.role == "user" }&.content.presence ||
        raise(ArgumentError, "The build proposal needs instructions")
    end

    def confirmation_summary(instructions)
      "Run OpenCode in #{@project.root_path.presence || Dir.home} for #{@project.name}: #{instructions.truncate(240)}"
    end

    def context_snapshot
      {
        "project" => {
          "id" => @project.id,
          "name" => @project.name,
          "root_path" => @project.root_path
        },
        "scene" => @scene && {
          "id" => @scene.id,
          "scene_key" => @scene.scene_key,
          "title" => @scene.title,
          "desired_outcome" => @scene.desired_outcome
        },
        "conversation" => {
          "id" => @conversation.id,
          "summary" => @conversation.summary,
          "messages" => @conversation.visible_messages.last(10).map do |message|
            { "id" => message.id, "role" => message.role, "content" => message.content.to_s.truncate(1_000) }
          end
        }
      }.compact
    end
  end
end
