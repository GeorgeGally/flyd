class OpencodeBuildJob < ApplicationJob
  require "open3"

  queue_as :default

  def perform(build_id)
    build = Build.find(build_id)
    return unless build.status == "pending"

    build.start!
    BuildChannel.broadcast_to(build, { status: "preparing" })

    context = build_context(build)
    input = "Build the following: #{build.conversation.messages.ordered.last&.content}"

    build.update!(status: "running", context_snapshot: { context: context, input: input })
    BuildChannel.broadcast_to(build, { status: "running" })

    result = execute_opencode(input, context, build.project.root_path)

    if result[:success]
      build.complete!(output: result[:output], summary: result[:summary])
      BuildChannel.broadcast_to(build, { status: "complete", summary: result[:summary] })
    else
      build.fail!(reason: result[:error])
      BuildChannel.broadcast_to(build, { status: "failed", error: result[:error] })
    end
  end

  private

  def build_context(build)
    engine = Subsystems::MemoryEngine.new(build.project)
    context = engine.relevant_context(build.conversation)

    <<~CONTEXT
      Project: #{build.project.name}
      Root path: #{build.project.root_path || "N/A"}

      #{context}

      Conversation summary:
      #{build.conversation.messages.ordered.map { |m| "#{m.role}: #{m.content}" }.join("\n").truncate(1000)}
    CONTEXT
  end

  def execute_opencode(input, context, root_path)
    Dir.mktmpdir("flyd-build") do |dir|
      context_file = File.join(dir, "context.md")
      File.write(context_file, context)

      cmd = ["opencode", "run", input, "-f", context_file, "--auto", "--format", "json"]
      chdir = root_path.presence || Dir.home

      stdout, stderr, status = Open3.capture3(*cmd, chdir: chdir)

      if status.success?
        output = parse_opencode_output(stdout)
        { success: true, output: output[:text], summary: output[:summary] }
      else
        { success: false, error: stderr.presence || stdout }
      end
    end
  rescue => e
    { success: false, error: e.message }
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
