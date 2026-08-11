// Plain colored dots rather than pin icons — the "your location" blue dot
// familiar from Google Maps, extended to restaurants (colored by status —
// see statusColor.ts) and to LocationPicker's draggable point. Shared by
// RestaurantMap.vue and LocationPicker.vue so every map in the app uses
// the exact same marker look.
export function createDotElement(color: string, opts: { size?: number; halo?: boolean; borderColor?: string } = {}): HTMLDivElement {
  const size = opts.size ?? 14
  // Mapbox repositions THIS element (`el`) via el.style.transform on every
  // pan/zoom frame — it must never be touched by our own transform/
  // transition, or every Mapbox-driven position update gets animated
  // through whatever transition we left behind instead of snapping
  // instantly, which looks like the marker drifting/swimming while
  // zooming. All hover-scale styling happens on `inner` instead, which
  // Mapbox never touches. See PRD.md follow-up.
  const el = document.createElement('div')
  // No position set here — Mapbox's own .mapboxgl-marker CSS class already
  // sets position:absolute on this element; setting it again inline was
  // redundant at best, and inline styles beat class rules, so it risked
  // fighting Mapbox for a property this element doesn't own.
  el.style.width = `${size}px`
  el.style.height = `${size}px`

  const inner = document.createElement('div')
  inner.dataset.markerInner = 'true'
  inner.style.position = 'relative'
  inner.style.width = '100%'
  inner.style.height = '100%'
  inner.style.transition = 'transform 0.1s ease-out'
  el.appendChild(inner)

  if (opts.halo) {
    const halo = document.createElement('div')
    halo.style.position = 'absolute'
    halo.style.inset = `-${Math.round(size * 0.7)}px`
    halo.style.borderRadius = '50%'
    halo.style.backgroundColor = color
    halo.style.opacity = '0.25'
    inner.appendChild(halo)
  }

  const dot = document.createElement('div')
  dot.style.position = 'absolute'
  dot.style.inset = '0'
  dot.style.borderRadius = '50%'
  dot.style.backgroundColor = color
  // A white fill needs a dark outline or it vanishes against a light
  // basemap — every other color keeps the original white ring, which reads
  // as a halo against the map rather than a border. See src/lib/
  // statusColor.ts (the want-to-try state is pure white).
  dot.style.border = `2px solid ${opts.borderColor ?? 'white'}`
  dot.style.boxShadow = '0 1px 3px rgba(0,0,0,0.45)'
  inner.appendChild(dot)

  return el
}
