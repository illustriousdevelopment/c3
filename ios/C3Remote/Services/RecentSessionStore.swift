import Foundation

enum RecentSessionStore {
    private static let storageKeyPrefix = "c3.remote.recentInteractions."
    private static let maximumEntries = 200

    static func load(namespace: String) -> [String: Date] {
        guard let stored = UserDefaults.standard.dictionary(
            forKey: storageKey(namespace: namespace)
        ) else { return [:] }
        return stored.reduce(into: [:]) { result, entry in
            guard let timestamp = entry.value as? NSNumber,
                  timestamp.doubleValue > 0 else { return }
            result[entry.key] = Date(timeIntervalSince1970: timestamp.doubleValue)
        }
    }

    @discardableResult
    static func record(sessionID: String, namespace: String) -> Date {
        var interactions = load(namespace: namespace)
        let timestamp = Date()
        interactions[sessionID] = timestamp
        save(interactions, namespace: namespace)
        return timestamp
    }

    static func prune(keeping sessionIDs: Set<String>, namespace: String) -> [String: Date] {
        let interactions = load(namespace: namespace)
            .filter { sessionIDs.contains($0.key) }
            .sorted { $0.value > $1.value }
            .prefix(maximumEntries)
        let pruned = Dictionary(uniqueKeysWithValues: interactions.map { ($0.key, $0.value) })
        save(pruned, namespace: namespace)
        return pruned
    }

    private static func save(_ interactions: [String: Date], namespace: String) {
        let stored = interactions.mapValues(\.timeIntervalSince1970)
        UserDefaults.standard.set(stored, forKey: storageKey(namespace: namespace))
    }

    private static func storageKey(namespace: String) -> String {
        storageKeyPrefix + namespace
    }
}
