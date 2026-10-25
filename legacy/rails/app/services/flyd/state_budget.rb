module Flyd
  class StateBudget
    BudgetExceeded = Class.new(StandardError)
    Result = Data.define(:state, :dropped)
    Candidate = Data.define(:path, :array, :depth)
    PROTECTED_ARRAY_KEYS = %w[capabilities renderers providers candidates].freeze
    PROVIDER_COLLECTION_MINIMUMS = { "discoveries" => 3 }.freeze

    def self.call(state:, budget:)
      new(state:, budget:).call
    end

    def initialize(state:, budget:)
      @state = state.deep_dup
      @budget = budget
      @dropped = []
    end

    def call
      return result if within_budget?

      [ 1_000, 500, 250, 120, 60 ].each do |limit|
        truncate_strings!(@state, limit)
        return result if within_budget?
      end

      until within_budget?
        candidate = deepest_prunable_array(@state)
        break unless candidate

        removed = candidate.array.pop
        @dropped << "#{candidate.path}:#{identifier_for(removed)}"
      end

      raise BudgetExceeded, "Compiled world state exceeds #{@budget} characters" unless within_budget?

      result
    end

    private

    def result
      Result.new(state: @state, dropped: @dropped)
    end

    def within_budget?
      JSON.generate(@state).length <= @budget
    end

    def truncate_strings!(value, limit)
      case value
      when Hash
        value.each_value { |nested| truncate_strings!(nested, limit) }
      when Array
        value.each { |nested| truncate_strings!(nested, limit) }
      when String
        value.replace(value.truncate(limit)) if value.length > limit
      end
    end

    def deepest_prunable_array(value, path = "state", depth = 0, candidates = [])
      case value
      when Hash
        value.each do |key, nested|
          deepest_prunable_array(nested, "#{path}.#{key}", depth + 1, candidates)
        end
      when Array
        value.each_with_index do |nested, index|
          deepest_prunable_array(nested, "#{path}[#{index}]", depth + 1, candidates)
        end
        candidates << Candidate.new(path: path, array: value, depth: depth) if prunable?(path, value)
      end

      candidates.max_by do |candidate|
        [ candidate.depth, JSON.generate(candidate.array.last).length ]
      end
    end

    def prunable?(path, array)
      return false if array.empty?
      return false if provider_evidence_collection?(path) && array.length <= provider_collection_minimum(path)

      key = path.split(".").last.to_s.sub(/\[\d+\]\z/, "")
      !PROTECTED_ARRAY_KEYS.include?(key)
    end

    def provider_evidence_collection?(path)
      path.match?(/\Astate\.provider_state\.providers\[\d+\]\.data\.[^.]+\z/)
    end

    def provider_collection_minimum(path)
      PROVIDER_COLLECTION_MINIMUMS.fetch(path.split(".").last, 1)
    end

    def identifier_for(value)
      return value[:id] || value["id"] || value[:signal] || value["signal"] if value.is_a?(Hash)

      value.class.name
    end
  end
end
