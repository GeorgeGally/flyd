module IntelligenceState
  Snapshot = Data.define(:source, :snapshot_id, :state_digest, :generated_at, :fresh, :data, :errors)

  class Provider
    def snapshot
      raise NotImplementedError
    end
  end
end
