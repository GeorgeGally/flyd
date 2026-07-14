class OpencodeBuildJob < ApplicationJob
  require "open3"
  require "timeout"

  EXECUTION_TIMEOUT = 30.minutes

  queue_as :default

  def perform(build_id)
    build = Build.includes(:project, :conversation, :scene).find(build_id)
    return unless build.status == "pending"

    build.start!
    BuildChannel.broadcast_to(build, { status: "preparing" })

    context = approved_context(build)
    input = build.instructions.presence || raise(ArgumentError, "Confirmed build has no instructions")

    build.update!(status: "running")
    BuildChannel.broadcast_to(build, { status: "running" })

    result = execute_opencode(input, context, build.project.root_path)

    if result[:success]
      complete_build(build, result)
    else
      fail_build(build, result[:error])
    end
  end

  private

  def approved_context(build)
    snapshot = build.context_snapshot.to_h
    return live_context(build) if snapshot.blank?

    project = snapshot["project"].to_h
    scene = snapshot["scene"].to_h
    conversation = snapshot["conversation"].to_h
    messages = Array(conversation["messages"]).map { |message| "#{message["role"]}: #{message["content"]}" }.join("\n")

    <<~CONTEXT
      Project: #{project["name"] || build.project.name}
      Root path: #{project["root_path"].presence || build.project.root_path || "N/A"}

      Scene: #{scene["title"] || build.scene&.title}
      Desired outcome: #{scene["desired_outcome"] || build.scene&.desired_outcome}

      Approved memory context:
      #{snapshot["memory"]}

      Approved conversation snapshot:
      #{messages}
    CONTEXT
  end

  def live_context(build)
    messages = build.conversation.visible_messages.last(10).map do |message|
      "#{message.role}: #{message.content}"
    end.join("\n")
    memory = Subsystems::MemoryEngine.new(build.project).relevant_context(build.conversation)

    <<~CONTEXT
      Project: #{build.project.name}
      Root path: #{build.project.root_path.presence || "N/A"}

      Scene: #{build.scene&.title || build.conversation.summary}
      Desired outcome: #{build.scene&.desired_outcome || build.instructions}

      Live memory context:
      #{memory}

      Live conversation context:
      #{messages}
    CONTEXT
  end

  def complete_build(build, result)
    scene = build.scene || ensure_scene(build)
    artifact = scene.artifacts.create!(
      project: build.project,
      context: build.conversation.context,
      conversation: build.conversation,
      build: build,
      kind: "build_result",
      status: "ready",
      title: result[:summary].presence || "Build result: #{scene.title}",
      content: result[:output],
      metadata: { "summary" => result[:summary], "completed_at" => Time.current.iso8601 }
    )

    build.complete!(output: result[:output], summary: result[:summary], artifact: artifact)
    scene.resolve!(artifact: artifact, summary: result[:summary])
    build.conversation.messages.create!(
      role: "assistant",
      content: "Build completed. #{result[:summary]}\n\nA durable build-result artifact was created: #{artifact.title}.",
      metadata: { "artifact_id" => artifact.id, "build_id" => build.id, "outcome" => "complete" }
    )

    BuildChannel.broadcast_to(build, { status: "complete", summary: result[:summary], artifact_id: artifact.id })
    ComposeSurfaceJob.enqueue(reason: "build_completed", active_conversation_id: build.conversation_id)
  end

  def fail_build(build, error)
    scene = build.scene || ensure_scene(build)
    artifact = scene.artifacts.create!(
      project: build.project,
      context: build.conversation.context,
      conversation: build.conversation,
      build: build,
      kind: "build_failure",
      status: "failed",
      title: "Build failed: #{scene.title}",
      content: error.to_s,
      metadata: { "failed_at" => Time.current.iso8601 }
    )

    build.fail!(reason: error, artifact: artifact)
    build.conversation.messages.create!(
      role: "assistant",
      content: "The build failed and the failure was preserved as an artifact so we can continue from it.\n\n#{error.to_s.truncate(1_000)}",
      metadata: { "artifact_id" => artifact.id, "build_id" => build.id, "outcome" => "failed" }
    )

    BuildChannel.broadcast_to(build, { status: "failed", error: error, artifact_id: artifact.id })
    ComposeSurfaceJob.enqueue(reason: "build_failed", active_conversation_id: build.conversation_id)
  end

  def ensure_scene(build)
    build.conversation.primary_scene || build.conversation.scenes.create!(
      scene_key: "conversation:#{build.conversation_id}",
      kind: "build",
      status: "active",
      title: build.conversation.summary.presence || "Build #{build.project.name}",
      summary: build.instructions,
      desired_outcome: build.instructions,
      project: build.project,
      context: build.conversation.context,
      last_presented_at: Time.current
    )
  end

  def execute_opencode(input, context, root_path)
    Dir.mktmpdir("flyd-build") do |dir|
      context_file = File.join(dir, "context.md")
      File.write(context_file, context)

      cmd = [ "opencode", "run", input, "-f", context_file, "--auto", "--format", "json" ]
      chdir = root_path.presence || Dir.home

      stdout, stderr, status = Timeout.timeout(EXECUTION_TIMEOUT) do
        Open3.capture3(*cmd, chdir: chdir)
      end

      if status.success?
        output = parse_opencode_output(stdout)
        { success: true, output: output[:text], summary: output[:summary] }
      else
        { success: false, error: stderr.presence || stdout }
      end
    end
  rescue Timeout::Error
    { success: false, error: "OpenCode execution timed out after #{EXECUTION_TIMEOUT.inspect}" }
  rescue StandardError => error
    { success: false, error: error.message }
  end

  def parse_opencode_output(stdout)
    text = +""
    first_line = nil
    stdout.each_line do |line|
      parsed = JSON.parse(line) rescue next
      if parsed["type"] == "text" && parsed.dig("part", "text")
        content = parsed["part"]["text"]
        text << content
        first_line ||= content.strip
      end
    end
    summary = first_line.to_s.truncate(100)
    { text: text, summary: summary }
  end
end
