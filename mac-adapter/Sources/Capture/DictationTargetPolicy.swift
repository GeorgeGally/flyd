enum DictationTargetPolicy {
    static func canInsert(into role: String) -> Bool {
        NativeExecutor.safeEditableRoles.contains(role)
    }
}
