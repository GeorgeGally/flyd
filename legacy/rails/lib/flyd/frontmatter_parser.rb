class Flyd::FrontmatterParser
  Result = Struct.new(:metadata, :body, keyword_init: true)

  DELIMITER = "---"

  def self.parse(content)
    new.parse(content)
  end

  def parse(content)
    return Result.new(metadata: {}, body: content) unless content.start_with?("#{DELIMITER}\n")

    end_idx = content.index("\n#{DELIMITER}", DELIMITER.length)
    return Result.new(metadata: {}, body: content) unless end_idx

    frontmatter = content[DELIMITER.length + 1..end_idx - 1].strip
    body = content[end_idx + DELIMITER.length + 1..]&.sub(/\A\n+/, "") || ""

    @metadata = {}
    @current_key = nil
    @list_mode = :idle
    @string_list = []
    @current_object = {}
    @object_list = []

    frontmatter.each_line do |line|
      line = line.chomp
      process_line(line)
    end

    flush_list if @list_mode != :idle

    Result.new(metadata: @metadata, body: body)
  end

  private

  def process_line(line)
    if match_item_line(line)
      nil
    elsif match_continuation_line(line)
      nil
    elsif match_key_value_line(line)
      nil
    end
  end

  def match_item_line(line)
    match = line.match(/\A  - (.+)\z/)
    return false unless match && @current_key

    item = match[1]
    if (kv = item.match(/\A(\w[\w_-]*):\s*(.*)\z/))
      finish_object if @list_mode == :object
      @list_mode = :object
      @current_object[kv[1]] = coerce_value(kv[2])
    else
      finish_object if @list_mode == :object
      @list_mode = :string
      @string_list << coerce_value(item)
    end
    true
  end

  def match_continuation_line(line)
    match = line.match(/\A    (\w[\w_-]*):\s*(.*)\z/)
    return false unless match && @current_key && @list_mode == :object

    @current_object[match[1]] = coerce_value(match[2])
    true
  end

  def match_key_value_line(line)
    kv = line.match(/\A(\w[\w_-]*):\s*(.*)\z/)
    return false unless kv

    key, val = kv[1], kv[2]

    flush_list if @list_mode != :idle

    if val.strip.empty?
      @current_key = key
      @list_mode = :idle
    else
      @current_key = nil
      @metadata[key] = coerce_value(val)
    end
    true
  end

  def flush_list
    finish_object if @list_mode == :object

    combined = []
    combined.concat(@object_list) if @object_list.any?
    combined.concat(@string_list) if @string_list.any?

    @metadata[@current_key] = combined if combined.any? && @current_key
    @object_list = []
    @string_list = []
    @list_mode = :idle
  end

  def finish_object
    if @current_object.any?
      @object_list << @current_object
      @current_object = {}
    end
  end

  def coerce_value(raw)
    trimmed = raw.strip
    return trimmed if trimmed.empty?

    if trimmed.match?(/\A-?\d+(\.\d+)?\z/)
      trimmed.include?(".") ? trimmed.to_f : trimmed.to_i
    elsif trimmed == "true"
      true
    elsif trimmed == "false"
      false
    else
      trimmed
    end
  end
end
