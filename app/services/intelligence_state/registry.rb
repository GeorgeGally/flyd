module IntelligenceState
  class Registry
    def self.snapshot
      new.snapshot
    end

    def initialize(providers: [ CliProvider.new, WebDiscoveryProvider.new ])
      @providers = providers
    end

    def snapshot
      snapshots = @providers.map(&:snapshot)
      {
        providers: snapshots.map do |snapshot|
          {
            source: snapshot.source,
            snapshot_id: snapshot.snapshot_id,
            state_digest: snapshot.state_digest,
            generated_at: snapshot.generated_at&.iso8601,
            fresh: snapshot.fresh,
            errors: snapshot.errors,
            data: snapshot.data
          }
        end
      }
    end
  end
end
