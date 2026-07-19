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

    def initialize(command_runner: nil, bridge_path: Rails.root.join("cli/dist/runtime-bridge.js"), timeout: TIMEOUT)
      @command_runner = command_runner
      @bridge_path = Pathname(bridge_path)
      @timeout = timeout
    end

    def call(request)
      input = JSON.generate(request)
      raise Error, "Runtime command request is too large", code: "invalid_request" if input.bytesize > MAX_REQUEST_BYTES

      stdout, stderr, status = run(input)
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

    def run(input)
      return Timeout.timeout(@timeout) do
        @command_runner.call(*command, stdin_data: input, chdir: Rails.root.join("cli").to_s)
      end if @command_runner

      run_subprocess(input)
    end

    def run_subprocess(input)
      stdin = stdout = stderr = wait_thread = nil
      output_thread = error_thread = nil
      stdin, stdout, stderr, wait_thread = Open3.popen3(
        *command,
        chdir: Rails.root.join("cli").to_s,
        pgroup: true
      )
      stdin.write(input)
      stdin.close
      output_thread = Thread.new { stdout.read }
      error_thread = Thread.new { stderr.read }
      status = Timeout.timeout(@timeout) { wait_thread.value }
      [ output_thread.value, error_thread.value, status ]
    rescue Timeout::Error
      terminate_process_group(wait_thread&.pid)
      raise
    ensure
      stdin&.close unless stdin&.closed?
      stdout&.close unless stdout&.closed?
      stderr&.close unless stderr&.closed?
      output_thread&.kill if output_thread&.alive?
      error_thread&.kill if error_thread&.alive?
    end

    def terminate_process_group(pid)
      return unless pid

      Process.kill("TERM", -pid)
      Timeout.timeout(1.second) { Process.wait(pid) }
    rescue Errno::ESRCH, Errno::ECHILD
      nil
    rescue Timeout::Error
      Process.kill("KILL", -pid)
    rescue Errno::ESRCH
      nil
    end

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
