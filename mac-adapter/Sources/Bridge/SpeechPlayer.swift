import AVFoundation

final class SpeechPlayer: NSObject {
    static let shared = SpeechPlayer()

    private var player: AVAudioPlayer?

    func play(_ data: Data) {
        guard let player = try? AVAudioPlayer(data: data) else {
            appendCoreLog("SpeechPlayer: could not decode audio data")
            return
        }
        self.player = player
        player.delegate = self
        player.play()
    }

    func stop() {
        player?.stop()
        player = nil
    }
}

extension SpeechPlayer: AVAudioPlayerDelegate {
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        self.player = nil
    }
}
