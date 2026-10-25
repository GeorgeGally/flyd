class QmdClient
  def initialize(base_url: Rails.configuration.flyd[:qmd_sidecar_url])
    @base_url = base_url
    @available = true
  end

  def search(query, project: nil, limit: 10)
    return [] unless available?

    params = { query: query, limit: limit }
    params[:project] = project if project

    response = post("/search", params)
    return [] unless response

    response["results"] || []
  rescue StandardError => e
    Rails.logger.warn("qmd search failed: #{e.message}")
    mark_unavailable!
    []
  end

  def update_index
    return false unless available?
    post("/update", {})
    true
  rescue StandardError => e
    Rails.logger.warn("qmd update failed: #{e.message}")
    false
  end

  def available?
    @available
  end

  private

  def post(path, params)
    uri = URI("#{@base_url}#{path}")
    http = Net::HTTP.new(uri.host, uri.port)
    http.open_timeout = 2
    http.read_timeout = 5

    request = Net::HTTP::Post.new(uri.path, { "Content-Type" => "application/json" })
    request.body = params.to_json

    response = http.request(request)
    JSON.parse(response.body) if response.is_a?(Net::HTTPSuccess)
  rescue StandardError
    nil
  end

  def mark_unavailable!
    @available = false
  end
end
