import Foundation
import Security

enum PairingStore {
    private static let service = "com.jonpatterson.c3remote"
    private static let account = "remote-pairing"

    static func load() -> PairingConfiguration? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(PairingConfiguration.self, from: data)
    }

    static func save(_ configuration: PairingConfiguration) throws {
        let data = try JSONEncoder().encode(configuration)
        let key: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let values: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let updateStatus = SecItemUpdate(key as CFDictionary, values as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw RemoteAPIError.message("Could not update the pairing link securely.")
        }
        let item = key.merging(values) { _, new in new }
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
            throw RemoteAPIError.message("Could not store the pairing link securely.")
        }
    }

    static func remove() throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw RemoteAPIError.message("Could not remove the saved pairing link.")
        }
    }
}
