import Foundation

/// Native delivery history, written only after the island actually shows an
/// incident. No provider messages, credentials or account information are saved.
final class ProviderNoticeLedger {
    private let defaults: UserDefaults
    private let key = "flyd.shownProviderIncidents.v1"

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    var shown: Set<String> { Set(defaults.stringArray(forKey: key) ?? []) }

    func recordShown(_ id: String) {
        var ids = defaults.stringArray(forKey: key) ?? []
        guard !ids.contains(id) else { return }
        ids.append(id)
        defaults.set(Array(ids.suffix(128)), forKey: key)
    }
}
