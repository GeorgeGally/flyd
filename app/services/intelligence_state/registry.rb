module IntelligenceState
  class Registry
    def self.snapshot(query: nil)
      new.snapshot(query: query)
    end

    def initialize(providers: [ RuntimeTaskProvider.new, CliProvider.new, PersonalContextProvider.new, WebDiscoveryProvider.new, Last30DaysProvider.new, PosttractionProvider.new ], query_provider: CliQueryProvider.new)
      @providers = providers
      @query_provider = query_provider
    end

    def snapshot(query: nil)
      snapshots = @providers.map(&:snapshot)
      snapshots << @query_provider.snapshot(query: query) if query.present?
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
