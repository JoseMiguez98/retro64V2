---
name: Neo-Retro Pixel
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#cfc2d6'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#988d9f'
  outline-variant: '#4d4354'
  surface-tint: '#ddb7ff'
  primary: '#ddb7ff'
  on-primary: '#490080'
  primary-container: '#b76dff'
  on-primary-container: '#400071'
  inverse-primary: '#842bd2'
  secondary: '#adc6ff'
  on-secondary: '#002e6a'
  secondary-container: '#0566d9'
  on-secondary-container: '#e6ecff'
  tertiary: '#4ae176'
  on-tertiary: '#003915'
  tertiary-container: '#00a74b'
  on-tertiary-container: '#003111'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#f0dbff'
  primary-fixed-dim: '#ddb7ff'
  on-primary-fixed: '#2c0051'
  on-primary-fixed-variant: '#6900b3'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#adc6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#6bff8f'
  tertiary-fixed-dim: '#4ae176'
  on-tertiary-fixed: '#002109'
  on-tertiary-fixed-variant: '#005321'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  headline-xl:
    fontFamily: Space Mono
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Space Mono
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Space Mono
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Geist
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-sm:
    fontFamily: Space Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1'
  headline-xl-mobile:
    fontFamily: Space Mono
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
spacing:
  unit: 4px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 48px
  container-max: 1280px
---

## Brand & Style
The brand personality balances the precision of modern high-performance hosting with the evocative nostalgia of 8nd and 16-bit gaming eras. This design system employs a **Neo-Retro** aesthetic—fusing the structural clarity of **Minimalism** with the expressive visual language of **Pixel Art**.

The UI should feel "technical-yet-tactile," utilizing high-fidelity layout principles while injecting "digital artifacts" like scanlines and stepped geometry. The emotional response is one of high-speed reliability paired with the warmth of a vintage arcade cabinet. Avoid clunky retro-clichés; instead, use pixel-inspired elements as sophisticated accents within a clean, spacious interface.

## Colors
The palette is rooted in a deep, "off-black" charcoal background to allow neon accents to vibrate. 

- **Primary (Neon Purple):** Used for primary actions, active states, and high-energy highlights.
- **Secondary (Electric Blue):** Used for information-rich components, secondary buttons, and data visualization.
- **Tertiary (Handheld Green):** Reserved for "Online" statuses, success messages, and system health indicators.
- **Surface Tones:** Utilize a hierarchy of charcols (#1A1A1A, #242424) to create depth without relying on traditional shadows.
- **Background Effects:** Apply a subtle CRT scanline overlay (2px alternating opacity) on primary background surfaces to establish the retro atmosphere.

## Typography
Typography creates the bridge between the technical and the nostalgic. 

**Space Mono** acts as the "Pixel" surrogate for headings. It provides a monospaced, technical feel that mimics old terminal readouts while remaining highly legible and modern. Use it for H1-H3 and small labels to punch through the layout.

**Geist** is the workhorse for all body copy, navigation items, and data displays. Its neutral, high-precision construction ensures that the platform feels like a modern SaaS product, preventing "retro-fatigue."

## Layout & Spacing
The layout follows a **Fluid Grid** model with a rigid 4px baseline unit, ensuring all elements align to a "pixel grid" logic. 

- **Desktop:** 12-column grid with generous 48px margins to emphasize the minimalist aesthetic. 
- **Tablet:** 8-column grid with 32px margins.
- **Mobile:** 4-column grid with 16px margins.

Spacing should be aggressive and open. Use large "macro-padding" (64px+) between sections to contrast with the "micro-precision" of the UI components. Elements should feel like they are floating in a digital void.

## Elevation & Depth
In this design system, depth is achieved through **Tonal Layering** and **High-Contrast Outlines** rather than soft shadows.

- **Level 0 (Base):** Deep charcoal (#121212) with a fixed scanline pattern.
- **Level 1 (Cards/Containers):** Slightly lighter charcoal (#1A1A1A) with a 1px solid border (#242424).
- **Level 2 (Popovers/Modals):** Dark surface with a "Neon Glow" border—a 1px solid line of the Primary or Secondary accent color.

Avoid blurs. If a shadow is necessary, use a "Hard Block Shadow"—a solid 4px offset of a darker neutral color with 0% blur, mimicking 8-bit sprite shadowing.

## Shapes
The shape language is strictly **Sharp (0px)**. To achieve the "Neo-Retro" look, use "Stepped Corners" for primary call-to-action buttons. These are corners that appear to be "clipped" or "pixelated" using a CSS `clip-path` or nested borders, creating a 4px or 8px notched effect instead of a smooth radius. 

Photography and console artwork should remain sharp-edged, occasionally framed within a 1px "internal border" to separate the image from the background.

## Components

### Buttons
Primary buttons use a solid Neon Purple fill with black text. On hover, they shift to Electric Blue. All buttons must have the "Stepped Corner" effect. Secondary buttons are ghost-style with a 2px white or neon border.

### Chips & Tags
Small, rectangular containers with a monospace font. Use Tertiary Green for "Live" status chips, accompanied by a small pulsing square "pixel" icon.

### Input Fields
Inputs are minimal: a bottom-border only in the inactive state, shifting to a full neon-outlined box when focused. The cursor should be a solid, blinking block.

### Cards
Cards use a flat background (#1A1A1A). The "Stepped Corner" should only apply to the outer container. Game art inside the card should be full-bleed at the top, transitioning into the dark card surface with a hard pixel-dithered gradient rather than a smooth fade.

### Lists
Lists use high-contrast dividers (1px solid #242424). Row hovers should trigger a full-width background color change to a very subtle grey or a faint purple tint, appearing instantly without a transition fade to mimic old software.