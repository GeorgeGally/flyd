import consumer from "channels/consumer"

export function subscribeToChat(conversationId, onToken) {
  const channel = consumer.subscriptions.create(
    { channel: "ChatChannel", conversation_id: conversationId },
    {
      connected() {
        console.log("ChatChannel connected")
      },
      disconnected() {
        console.log("ChatChannel disconnected")
      },
      received(data) {
        if (data.token) {
          onToken(data.token)
        } else if (data.done) {
          onToken(null, true)
        }
      }
    }
  )
  return channel
}
