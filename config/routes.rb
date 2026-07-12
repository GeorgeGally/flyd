Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  resource :surface, only: :show
  resources :intents, only: :create do
    resources :context_corrections, only: :create
    resources :contexts, only: :create
  end
  resources :intent_attachments, only: :show

  resources :surface_items, only: [] do
    post "actions/:action_id", to: "surface_item_actions#create", as: :action
    resources :feedbacks, only: :create, controller: "surface_feedbacks"
    resources :context_corrections, only: :create
    get :sources, to: "surface_item_sources#show"
  end

  resources :conversations, only: :show do
    resources :messages, only: :create
  end

  resources :projects do
    member do
      post :archive
      post :reactivate
    end

    resources :conversations, only: [ :show, :create, :destroy ] do
      resources :messages, only: [ :create ]
      resources :builds, only: [ :create, :show ]
    end
  end

  root "surfaces#show"

  resource :settings, only: [ :show, :update ]
end
