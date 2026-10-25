class SettingsController < ApplicationController
  skip_before_action :check_api_keys, only: [:show, :update]

  def show
    @missing = missing_keys
    @has_keys = @missing.empty?
  end

  def update
    updates = {}
    updates["OPENAI_API_KEY"] = params[:openai_api_key] if params[:openai_api_key].present?
    updates["ANTHROPIC_API_KEY"] = params[:anthropic_api_key] if params[:anthropic_api_key].present?

    if updates.any?
      Flyd::KeyLoader.save!(updates)
      redirect_to settings_path, notice: "API keys saved."
    else
      redirect_to settings_path, alert: "No keys provided."
    end
  end

  private

  def missing_keys
    missing = []
    missing << "OpenAI" unless Flyd::KeyLoader.get("OPENAI_API_KEY")
    missing << "Anthropic" unless Flyd::KeyLoader.get("ANTHROPIC_API_KEY")
    missing
  end
end
