import CoreAudio
import Foundation

/// Mutes the Mac's sound output while the mic is capturing, so music, video and
/// anything else playing doesn't bleed into George's words and ruin the
/// transcript. It restores exactly what it changed: a device George had already
/// muted stays muted, and one it muted is unmuted on the same device even if the
/// default output switched meanwhile. The mute is remembered on disk so a crash
/// or a reinstall mid-capture unmutes on the next launch instead of leaving the
/// Mac silent.
enum SystemAudioMute {
    private static let pendingKey = "SystemAudioMute.mutedDevice"
    private static let lock = NSLock()
    private static var mutedDevice: AudioDeviceID?

    static func engage() {
        lock.withLock {
            guard mutedDevice == nil, let device = defaultOutputDevice() else { return }
            guard !isMuted(device), setMuted(device, true) else { return }
            mutedDevice = device
            UserDefaults.standard.set(Int(device), forKey: pendingKey)
        }
    }

    static func release() {
        lock.withLock {
            guard let device = mutedDevice else { return }
            _ = setMuted(device, false)
            mutedDevice = nil
            UserDefaults.standard.removeObject(forKey: pendingKey)
        }
    }

    /// Undoes a mute left behind when Flyd quit mid-capture.
    static func recoverAfterLaunch() {
        guard let stored = UserDefaults.standard.object(forKey: pendingKey) as? Int else { return }
        _ = setMuted(AudioDeviceID(stored), false)
        UserDefaults.standard.removeObject(forKey: pendingKey)
    }

    private static func defaultOutputDevice() -> AudioDeviceID? {
        var device = AudioDeviceID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device)
        return status == noErr && device != kAudioObjectUnknown ? device : nil
    }

    private static func muteAddress() -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyMute,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain
        )
    }

    private static func isMuted(_ device: AudioDeviceID) -> Bool {
        var address = muteAddress()
        guard AudioObjectHasProperty(device, &address) else { return false }
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        return AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr && value != 0
    }

    private static func setMuted(_ device: AudioDeviceID, _ muted: Bool) -> Bool {
        var address = muteAddress()
        var settable: DarwinBoolean = false
        guard AudioObjectHasProperty(device, &address),
              AudioObjectIsPropertySettable(device, &address, &settable) == noErr,
              settable.boolValue else { return false }
        var value: UInt32 = muted ? 1 : 0
        return AudioObjectSetPropertyData(device, &address, 0, nil, UInt32(MemoryLayout<UInt32>.size), &value) == noErr
    }
}
