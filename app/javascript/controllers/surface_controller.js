import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["plane", "intent", "input", "item", "conversation", "launcher"]

  connect() {
    this.handleMorph = this.handleMorph.bind(this)
    this.handleGlobalKeydown = this.handleGlobalKeydown.bind(this)
    document.addEventListener("turbo:morph", this.handleMorph)
    document.addEventListener("keydown", this.handleGlobalKeydown)
    this.applySemanticLayout(this.element.dataset.intentActive === "true")
    this.applyRuntimeFocus()
    this.hideFailedImages()
    this.focusActiveIntent()
  }

  disconnect() {
    document.removeEventListener("turbo:morph", this.handleMorph)
    document.removeEventListener("keydown", this.handleGlobalKeydown)
  }

  handleMorph() {
    this.applySemanticLayout(this.element.dataset.intentActive === "true")
    this.applyRuntimeFocus()
    this.hideFailedImages()
    this.focusActiveIntent()
  }

  focusIntent() {
    this.element.dataset.intentActive = "true"
    this.intentTarget.setAttribute("aria-hidden", "false")
    this.applySemanticLayout(true)
  }

  openIntent(event) {
    event?.preventDefault()
    this.focusIntent()
    this.focusActiveIntent()
  }

  closeIntent(event) {
    event?.preventDefault()
    delete this.element.dataset.intentActive
    this.intentTarget.setAttribute("aria-hidden", "true")
    this.inputTarget.blur()
    this.applySemanticLayout(false)
    if (event?.type === "click" && this.hasLauncherTarget) this.launcherTarget.focus()
  }

  handleGlobalKeydown(event) {
    if (event.key === "/" && !this.editingText()) this.openIntent(event)
    if (event.key === "Escape" && this.element.dataset.intentActive === "true") this.closeIntent(event)
    if (!this.editingText() && this.posterDeck() && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault()
      this.cycleFocus(event.key === "ArrowRight" ? 1 : -1)
    }
  }

  focusObject(event) {
    if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return
    if (event.target.closest("a, button, input, textarea, select")) return

    event.preventDefault()
    this.setRuntimeFocus(event.currentTarget)
  }

  cycleFocus(direction) {
    const items = this.itemTargets.filter((item) => item.closest("[data-surface-composition='poster_deck']"))
    if (items.length < 2) return

    const index = items.findIndex((item) => item.classList.contains("is-runtime-focus"))
    this.setRuntimeFocus(items[(index + direction + items.length) % items.length])
  }

  startSwipe(event) {
    this.swipeStartX = event.touches[0]?.clientX
  }

  endSwipe(event) {
    if (this.swipeStartX == null) return

    const distance = event.changedTouches[0]?.clientX - this.swipeStartX
    this.swipeStartX = null
    if (Math.abs(distance) < 45) return

    this.cycleFocus(distance < 0 ? 1 : -1)
  }

  hideBrokenImage(event) {
    const field = event.currentTarget.closest(".discovery-poster__image-field")
    const poster = event.currentTarget.closest(".discovery-poster")
    field?.remove()
    if (poster) poster.dataset.hasImage = "false"
  }

  hideFailedImages() {
    this.element.querySelectorAll(".discovery-poster__image").forEach((image) => {
      if (!image.complete) return
      if (image.naturalWidth === 0 || image.naturalWidth < 5 || image.naturalHeight < 5) {
        this.hideBrokenImage({ currentTarget: image })
      }
    })
  }

  setRuntimeFocus(focus) {
    if (!focus || !this.hasPlaneTarget) return

    this.planeTarget.dataset.runtimeFocusKey = focus.dataset.itemKey
    this.applyRuntimeFocus()
  }

  applyRuntimeFocus() {
    if (!this.posterDeck()) return

    const focusKey = this.planeTarget.dataset.runtimeFocusKey || this.planeTarget.dataset.surfaceFocusKey
    this.itemTargets.forEach((item) => {
      const focused = item.dataset.itemKey === focusKey
      item.classList.toggle("is-runtime-focus", focused)
      item.classList.toggle("is-runtime-support", !focused)
      item.setAttribute("aria-current", focused ? "true" : "false")
    })
  }

  posterDeck() {
    return this.hasPlaneTarget && this.planeTarget.dataset.surfaceComposition === "poster_deck"
  }

  releaseIntent(event) {
    if (event?.type === "keydown") return this.closeIntent(event)
    window.setTimeout(() => {
      if (!this.intentTarget.contains(document.activeElement)) {
        delete this.element.dataset.intentActive
        this.intentTarget.setAttribute("aria-hidden", "true")
        this.applySemanticLayout(false)
      }
    }, 0)
  }

  resizeIntent() {
    const input = this.inputTarget
    input.style.height = "auto"
    input.style.height = `${Math.min(input.scrollHeight, 260)}px`
  }

  focusActiveIntent() {
    if (this.element.dataset.intentActive !== "true" || !this.hasInputTarget || this.editingText()) return

    window.requestAnimationFrame(() => this.inputTarget.focus())
  }

  submitOnCommandEnter(event) {
    if (event.key !== "Enter" || !event.metaKey) return

    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  applySemanticLayout(active) {
    const focusKey = this.hasPlaneTarget ? this.planeTarget.dataset.surfaceFocusKey : null

    this.itemTargets.forEach((item) => {
      const incoming = this.behaviours(item.dataset.incomingBehaviours)
      const outgoing = this.behaviours(item.dataset.outgoingBehaviours)
      const depth = item.dataset.depth
      const isFocus = item.dataset.itemKey === focusKey
      const returning = incoming.includes("return") || outgoing.includes("return")
      const yielding = !returning && (incoming.includes("yield") || incoming.includes("recede") || depth === "background" || depth === "receded")
      const leaving = !returning && incoming.includes("leave")
      const replacing = !returning && incoming.includes("replace")
      const collapsing = !returning && incoming.includes("collapse")
      const joining = returning || isFocus || incoming.includes("join")

      item.classList.toggle("opacity-35", active && yielding)
      item.classList.toggle("translate-x-8", active && yielding)
      item.classList.toggle("blur-[1px]", active && (yielding || depth === "receded"))
      item.classList.toggle("opacity-0", active && (leaving || replacing || collapsing))
      item.classList.toggle("-translate-y-6", active && leaving)
      item.classList.toggle("scale-95", active && replacing)
      item.classList.toggle("max-h-0", active && collapsing)
      item.classList.toggle("overflow-hidden", active && collapsing)
      item.classList.toggle("pointer-events-none", active && (leaving || replacing || collapsing))
      item.classList.toggle("scale-[1.015]", active && joining)
      item.classList.toggle("z-30", active && joining)
    })
  }

  behaviours(value) {
    return (value || "").split(" ").filter(Boolean)
  }

  editingText() {
    const element = document.activeElement
    return element?.matches("input, textarea, select, [contenteditable='true']")
  }
}
