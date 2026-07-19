import { Controller } from "@hotwired/stimulus"
import { subscribeToChat } from "channels/chat_channel"

export default class extends Controller {
  static targets = ["input", "messages", "streamingMessage", "streamingContent"]
  static values = { conversationId: Number }

  connect() {
    this.channel = subscribeToChat(this.conversationIdValue, (token, done) => {
      if (done) {
        this.finalizeStreaming()
      } else {
        this.appendToken(token)
      }
    })
  }

  disconnect() {
    this.channel?.unsubscribe()
  }

  submitOnCommandEnter(event) {
    if (event.key !== "Enter" || !event.metaKey) return

    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  async submit(event) {
    event.preventDefault()
    const content = this.inputTarget.value.trim()
    if (!content) return

    const pendingMessage = this.appendUserMessage(content)
    this.showStreamingPlaceholder()
    this.inputTarget.value = ""
    this.inputTarget.style.height = "auto"
    this.element.dataset.chatSubmitState = "sending"

    const csrfToken = document.querySelector("[name='csrf-token']")?.content
    const formAction = this.inputTarget.closest("form")?.action

    if (!formAction) {
      pendingMessage.remove()
      this.inputTarget.value = content
      this.hideStreamingPlaceholder()
      this.element.dataset.chatSubmitState = "failed"
      this.showError("Could not send message. Please refresh the page.")
      return
    }

    try {
      const headers = { "Content-Type": "application/json" }
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken
      const response = await fetch(formAction, {
        method: "POST",
        headers,
        body: JSON.stringify({ message: { content } })
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.errors?.join(", ") || `Message failed with status ${response.status}`)
      }
      this.element.dataset.chatSubmitState = "sent"
    } catch (error) {
      pendingMessage.remove()
      this.inputTarget.value = content
      this.hideStreamingPlaceholder()
      this.element.dataset.chatSubmitState = "failed"
      this.showError(error instanceof Error ? error.message : "Network error. Check your connection and try again.")
    }
  }

  appendUserMessage(content) {
    const div = document.createElement("div")
    div.className = "flex justify-end mb-4"
    div.innerHTML = `<div class="max-w-[80%] rounded-lg px-4 py-2 bg-gray-900 text-white text-sm"><p>${this.escapeHtml(content)}</p></div>`
    this.messagesTarget.appendChild(div)
    this.scrollToBottom()
    return div
  }

  showStreamingPlaceholder() {
    this.streamingMessageTarget.classList.remove("hidden")
  }

  hideStreamingPlaceholder() {
    this.streamingMessageTarget.classList.add("hidden")
  }

  appendToken(token) {
    this.streamingContentTarget.textContent += token
    this.scrollToBottom()
  }

  finalizeStreaming() {
    const content = this.streamingContentTarget.textContent
    this.streamingMessageTarget.classList.add("hidden")
    this.streamingContentTarget.textContent = ""

    const div = document.createElement("div")
    div.className = "flex justify-start mb-4"
    div.innerHTML = `<div class="max-w-[80%] rounded-lg px-4 py-2 bg-gray-100 text-gray-900 text-sm">${this.renderMarkdown(content)}</div>`
    this.messagesTarget.appendChild(div)
    this.scrollToBottom()
  }

  showError(message) {
    const div = document.createElement("div")
    div.className = "flex justify-center mb-4"
    div.innerHTML = `<div class="rounded-lg px-4 py-2 bg-red-50 border border-red-200 text-red-700 text-sm">${this.escapeHtml(message)}</div>`
    this.messagesTarget.appendChild(div)
    this.scrollToBottom()
  }

  scrollToBottom() {
    this.messagesTarget.scrollTop = this.messagesTarget.scrollHeight
  }

  escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }

  renderMarkdown(text) {
    return text.replace(/\n/g, "<br>").replace(/`([^`]+)`/g, (_, code) => `<code class='bg-gray-200 px-1 rounded text-xs'>${this.escapeHtml(code)}</code>`)
  }
}
