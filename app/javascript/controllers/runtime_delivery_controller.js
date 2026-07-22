import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = { eventId: Number, surfaceId: Number, surfaceItemId: Number, bindingDigest: String }

  connect() {
    if (!this.hasEventIdValue || this.acknowledged()) return
    this.acknowledge()
  }

  async acknowledge() {
    try {
      const response = await fetch("/runtime_delivery_receipts", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": document.querySelector("meta[name='csrf-token']")?.content || ""
        },
        body: JSON.stringify({
          runtime_event_id: this.eventIdValue,
          surface_id: this.hasSurfaceIdValue ? this.surfaceIdValue : null,
          surface_item_id: this.hasSurfaceItemIdValue ? this.surfaceItemIdValue : null,
          binding_digest: this.hasBindingDigestValue ? this.bindingDigestValue : null,
          client_id: this.clientId()
        })
      })

      if (response.ok) sessionStorage.setItem(this.receiptKey(), "1")
    } catch {
      // A later broadcast can retry the receipt without disturbing the interface.
    }
  }

  acknowledged() {
    return sessionStorage.getItem(this.receiptKey()) === "1"
  }

  receiptKey() {
    return `flyd-runtime-delivery:${this.eventIdValue}`
  }

  clientId() {
    let id = localStorage.getItem("flyd-runtime-client")
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
      localStorage.setItem("flyd-runtime-client", id)
    }
    return id
  }
}
