module IntelligenceState
  Snapshot = Data.define(:source, :generated_at, :fresh, :data, :errors)

  class Provider
    def snapshot
      raise NotImplementedError
    end
  end
end
