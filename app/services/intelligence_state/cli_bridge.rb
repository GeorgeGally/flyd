require "json"
require "open3"
require "timeout"

module IntelligenceState
  class CliBridge
    class Error < StandardError; end

    TIMEOUT = 30.seconds

    def initialize(command_runner: Open3.method(:capture3), bridge_path: Rails.root.join("cli/dist/bridge.js"))
      @command_runner = command_runner
      @bridge_path = bridge_path
    end

    def retrieve(query)
      stdout, stderr, status = Timeout.timeout(TIMEOUT) do
        @command_runner.call(*command(query), chdir: Rails.root.join("cli").to_s)
      end
      raise Error, "CLI brain retrieval failed: #{stderr.presence || stdout}" unless status.success?

      payload = JSON.parse(stdout)
      raise Error, "CLI brain retrieval returned an error: #{payload.fetch("error")}" if payload["error"].present?

      payload
    rescue JSON::ParserError => error
      raise Error, "CLI brain retrieval returned invalid JSON: #{error.message}"
    rescue Errno::ENOENT, Timeout::Error => error
      raise Error, "CLI brain retrieval unavailable: #{error.message}"
    end

    private

    def command(query)
      if @bridge_path.exist?
        [ "node", @bridge_path.to_s, "retrieve", "--query", query ]
      elsif Rails.env.production?
        raise Error, "Compiled CLI brain bridge missing at #{@bridge_path}"
      else
        [ "npm", "exec", "--", "tsx", "src/bridge.ts", "retrieve", "--query", query ]
      end
    end
  end
end
