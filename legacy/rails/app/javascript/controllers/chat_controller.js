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
    div.className = "sys-msg sys-msg--user"
    div.innerHTML = `<div class="sys-msg__role">You</div><div class="sys-msg__body"><p>${this.escapeHtml(content)}</p></div>`
    this.messagesTarget.querySelector(".sys-transcript")?.appendChild(div) || this.messagesTarget.appendChild(div)
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
    div.className = "sys-msg"
    div.innerHTML = `<div class="sys-msg__role">Flyd</div><div class="sys-msg__body">${this.renderMarkdown(content)}</div>`
    this.messagesTarget.querySelector(".sys-transcript")?.appendChild(div) || this.messagesTarget.appendChild(div)
    this.scrollToBottom()
  }

  showError(message) {
    const div = document.createElement("div")
    div.className = "sys-msg"
    div.innerHTML = `<div class="sys-msg__role">Notice</div><div class="sys-msg__body"><p class="sys-error">${this.escapeHtml(message)}</p></div>`
    this.messagesTarget.querySelector(".sys-transcript")?.appendChild(div) || this.messagesTarget.appendChild(div)
    this.scrollToBottom()
  }

  scrollToBottom() {
    this.messagesTarget.scrollTop = this.messagesTarget.scrollHeight
  }

  escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }

  renderMarkdown(text) {
    return this.escapeHtml(text)
      .replace(/\n/g, "<br>")
      .replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)
  }
}
