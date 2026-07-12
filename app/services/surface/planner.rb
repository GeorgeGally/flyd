class Surface::Planner
  def self.call(active_conversation: nil)
    Flyd::Intelligence.compose_surface(active_conversation: active_conversation)
  end
end
