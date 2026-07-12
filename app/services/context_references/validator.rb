module ContextReferences
  class Validator
    class InvalidReference < ArgumentError; end

    ALLOWED_TYPES = %w[project context].freeze

    def self.call(references)
      new(references).call
    end

    def initialize(references)
      @references = Array(references)
    end

    def call
      @references.filter_map do |reference|
        value = reference.respond_to?(:permit) ? reference.permit(:type, :id, :name).to_h : reference.to_h.stringify_keys
        type = value["type"].to_s
        id = value["id"].to_s
        next if type.blank? && id.blank?

        raise InvalidReference, "Unsupported context type: #{type}" unless ALLOWED_TYPES.include?(type)
        record = resolve(type, id)
        raise InvalidReference, "Unknown #{type} context: #{id}" unless record

        { "type" => type, "id" => record.id, "name" => record.name }
      end.uniq { |reference| [ reference["type"], reference["id"].to_s ] }
    end

    private

    def resolve(type, id)
      case type
      when "project" then Project.active.find_by(id: id)
      when "context" then Context.active.find_by(id: id)
      end
    end
  end
end
