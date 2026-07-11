import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["plane", "intent", "input", "item", "conversation"]

  focusIntent() {
    this.element.dataset.intentActive = "true"
    this.applyFocusedLayout(true)
  }

  releaseIntent(event) {
    if (event?.type === "keydown") this.inputTarget.blur()
    window.setTimeout(() => {
      if (!this.intentTarget.contains(document.activeElement)) {
        delete this.element.dataset.intentActive
        this.applyFocusedLayout(false)
      }
    }, 0)
  }

  resizeIntent() {
    const input = this.inputTarget
    input.style.height = "auto"
    input.style.height = `${Math.min(input.scrollHeight, 260)}px`
  }

  applyFocusedLayout(active) {
    this.itemTargets.forEach((item, index) => {
      item.classList.toggle("md:col-span-7", active && index === 0)
      item.classList.toggle("md:col-span-3", active && index > 0)
      item.classList.toggle("opacity-45", active && index > 1)
      item.classList.toggle("translate-x-3", active && index > 0)
      item.classList.toggle("md:col-span-8", !active && index === 0)
      item.classList.toggle("md:col-span-4", !active && index > 0)
    })
  }
}
