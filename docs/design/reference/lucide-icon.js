// <lucide-icon name="lamp-desk" size="18" stroke="1.5"> — renders the exact Lucide
// geometry (from the official icon data) with currentColor. No hand-drawn paths.
(function () {
  const SRC = "https://unpkg.com/lucide@0.469.0/dist/umd/lucide.js";
  const NS = "http://www.w3.org/2000/svg";
  let ready = null;

  function loadLucide() {
    if (ready) return ready;
    ready = new Promise((resolve) => {
      if (window.lucide && window.lucide.icons) return resolve(window.lucide);
      let tag = document.querySelector('script[data-lucide-umd]');
      if (!tag) {
        tag = document.createElement("script");
        tag.src = SRC;
        tag.setAttribute("data-lucide-umd", "");
        document.head.appendChild(tag);
      }
      tag.addEventListener("load", () => resolve(window.lucide));
      if (window.lucide && window.lucide.icons) resolve(window.lucide);
    });
    return ready;
  }

  const pascal = (n) =>
    String(n).split(/[-_ ]+/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");

  function childrenOf(entry) {
    if (!entry) return null;
    // IconNode: [[tag, attrs], …]  |  legacy: ['svg', attrs, children]
    if (Array.isArray(entry) && entry[0] === "svg") return entry[2] || [];
    if (Array.isArray(entry)) return entry;
    if (entry.iconNode) return entry.iconNode;
    return null;
  }

  class LucideIcon extends HTMLElement {
    static get observedAttributes() { return ["name", "size", "stroke"]; }
    constructor() {
      // Shadow DOM: React owns the light DOM of this host node, so the SVG must
      // live where React never reconciles. currentColor still inherits through.
      super();
      this.attachShadow({ mode: "open" });
    }
    connectedCallback() { this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }

    async render() {
      const name = this.getAttribute("name") || "";
      if (!name || name.indexOf("{{") !== -1) return; // hole not resolved yet
      this._token = (this._token || 0) + 1;
      const token = this._token;
      const size = this.getAttribute("size") || "18";
      const stroke = this.getAttribute("stroke") || "1.5";
      this.style.display = "inline-flex";
      this.style.flexShrink = "0";
      this.style.lineHeight = "0";
      this.style.width = size + "px";
      this.style.height = size + "px";

      const lucide = await loadLucide();
      if (!this.isConnected || token !== this._token) return;
      const set = (lucide && lucide.icons) || {};
      const kids = childrenOf(set[pascal(name)] || set[name]);
      if (!kids) { console.warn("[lucide-icon] unknown icon:", name); return; }

      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", size);
      svg.setAttribute("height", size);
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", stroke);
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      svg.style.display = "block";
      for (const [tag, attrs] of kids) {
        const el = document.createElementNS(NS, tag);
        for (const k in attrs) if (k !== "key") el.setAttribute(k, attrs[k]);
        svg.appendChild(el);
      }
      this.shadowRoot.replaceChildren(svg);
    }
  }

  if (!customElements.get("lucide-icon")) customElements.define("lucide-icon", LucideIcon);
  loadLucide();
})();
