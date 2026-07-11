Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  resource :surface, only: :show
  resources :intents, only: :create

  resources :projects do
    member do
      post :archive
      post :reactivate
    end

    resources :conversations, only: [:show, :create, :destroy] do
      resources :messages, only: [:create]
      resources :builds, only: [:create, :show]
    end
  end

  root "surfaces#show"

  resource :settings, only: [:show, :update]
end
