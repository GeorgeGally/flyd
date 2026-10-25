class ApplicationController < ActionController::Base
  allow_browser versions: :modern

  before_action :check_api_keys

  private

  def check_api_keys
    return if Rails.env.test?
    return if controller_name == "settings"
    return if Flyd::KeyLoader.get("OPENAI_API_KEY") || Flyd::KeyLoader.get("ANTHROPIC_API_KEY")

    redirect_to settings_path
  end
end
