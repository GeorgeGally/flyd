module Workers
  class OpenCodeCommand
    PASSTHROUGH_ENVIRONMENT = %w[
      PATH HOME USER SHELL TMPDIR LANG LC_ALL XDG_CONFIG_HOME
    ].freeze

    def initialize(assignment:, project_root:, context_path: nil, session_id: nil, title: nil)
      @assignment = assignment
      @project_root = project_root
      @context_path = context_path
      @session_id = session_id
      @title = title
    end

    def argv
      [ "opencode", "run", @assignment ].tap do |arguments|
        if @session_id.present?
          arguments.push("--session", @session_id)
        elsif @context_path.present?
          arguments.push("-f", @context_path)
        end
        arguments.push("--format", "json", "--dir", @project_root)
        arguments.push("--title", @title) if @session_id.blank? && @title.present?
        arguments.push("--auto")
      end
    end

    def environment
      ENV.slice(*PASSTHROUGH_ENVIRONMENT).merge(
        "OPENCODE_CONFIG_CONTENT" => JSON.generate(permission_config)
      )
    end

    def permission_config
      {
        permission: {
          "*" => "deny",
          read: "allow",
          edit: "allow",
          glob: "allow",
          grep: "allow",
          list: "allow",
          lsp: "allow",
          todowrite: "allow",
          skill: "allow",
          question: "deny",
          task: "deny",
          webfetch: "deny",
          websearch: "deny",
          external_directory: "deny",
          bash: {
            "*" => "deny",
            "pwd" => "allow",
            "ls" => "allow",
            "ls *" => "allow",
            "find *" => "allow",
            "rg *" => "allow",
            "grep *" => "allow",
            "sed *" => "allow",
            "cat *" => "allow",
            "git status*" => "allow",
            "git diff*" => "allow",
            "git log*" => "allow",
            "git show*" => "allow",
            "bin/rails test*" => "allow",
            "bundle exec rails test*" => "allow",
            "bundle exec rubocop*" => "allow",
            "npm test*" => "allow",
            "npm run test*" => "allow",
            "npm run lint*" => "allow",
            "npm run build*" => "allow"
          }
        }
      }
    end
  end
end
