require "json"
require "open3"
require "timeout"

module AgentRuntime
  class Bridge
    class Error < StandardError
      attr_reader :code

      def initialize(message, code: "runtime_unavailable")
        @code = code
        super(message)
      end
    end

    TIMEOUT = 10.seconds
    MAX_REQUEST_BYTES = 64.kilobytes

    def initialize(command_runner: Open3.method(:capture3), bridge_path: Rails.root.join("cli/dist/runtime-bridge.js"))
      @command_runner = command_runner
      @bridge_path = Pathname(bridge_path)
    end

    def call(request)
      input = JSON.generate(request)
      raise Error, "Runtime command request is too large", code: "invalid_request" if input.bytesize > MAX_REQUEST_BYTES

      stdout, stderr, status = Timeout.timeout(TIMEOUT) do
        @command_runner.call(
          *command,
          stdin_data: input,
          chdir: Rails.root.join("cli").to_s
        )
      end
      payload = JSON.parse(stdout)
      unless status.success? && payload["ok"] == true
        failure = payload["error"].to_h
        raise Error.new(
          failure["message"].presence || stderr.presence || "Runtime command failed",
          code: failure["code"].presence || "runtime_failed"
        )
      end

      payload.fetch("result")
    rescue JSON::ParserError => error
      raise Error, "Runtime command bridge returned invalid JSON: #{error.message}"
    rescue Errno::ENOENT, Timeout::Error => error
      raise Error, "Runtime command bridge unavailable: #{error.message}"
    end

    private

    def command
      if @bridge_path.exist?
        [ "node", @bridge_path.to_s ]
      elsif Rails.env.production?
        raise Error, "Compiled runtime command bridge missing at #{@bridge_path}"
      else
        [ "npm", "exec", "--", "tsx", "src/runtime-bridge.ts" ]
      end
    end
  end
end
