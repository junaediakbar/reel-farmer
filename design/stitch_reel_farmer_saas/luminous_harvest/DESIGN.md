---
name: Luminous Harvest
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#464554'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#767586'
  outline-variant: '#c7c4d7'
  surface-tint: '#494bd6'
  primary: '#4648d4'
  on-primary: '#ffffff'
  primary-container: '#6063ee'
  on-primary-container: '#fffbff'
  inverse-primary: '#c0c1ff'
  secondary: '#8127cf'
  on-secondary: '#ffffff'
  secondary-container: '#9c48ea'
  on-secondary-container: '#fffbff'
  tertiary: '#a12e70'
  on-tertiary: '#ffffff'
  tertiary-container: '#c0488a'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e1e0ff'
  primary-fixed-dim: '#c0c1ff'
  on-primary-fixed: '#07006c'
  on-primary-fixed-variant: '#2f2ebe'
  secondary-fixed: '#f0dbff'
  secondary-fixed-dim: '#ddb7ff'
  on-secondary-fixed: '#2c0051'
  on-secondary-fixed-variant: '#6900b3'
  tertiary-fixed: '#ffd8e7'
  tertiary-fixed-dim: '#ffafd3'
  on-tertiary-fixed: '#3d0026'
  on-tertiary-fixed-variant: '#85145a'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 48px
    fontWeight: '800'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.25'
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: '1.3'
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  container-max: 1440px
  gutter: 24px
  margin-desktop: 64px
  margin-mobile: 20px
  stack-sm: 12px
  stack-md: 24px
  stack-lg: 48px
---

## Brand & Style

The design system is built on a **Soft Tech** aesthetic, blending high-performance functionality with a gentle, approachable interface. It targets a modern audience that values efficiency but dislikes the clinical coldness of traditional SaaS platforms.

The style leverages **Glassmorphism** and a "Cloud-like" layering strategy. Surfaces are characterized by high-transparency blurs, soft inner glows, and multi-layered drop shadows that create a sense of physical weightlessness. The emotional response is one of calm, clarity, and premium accessibility. Large radiuses and generous whitespace ensure the UI feels expansive and "airy," reducing cognitive load for the user.

## Colors

The palette is anchored by a vibrant, **Electric Violet-to-Indigo** primary spectrum. This provides a energetic focal point against a backdrop of "Off-White" and "Cool Slate" neutrals.

- **Primary:** Used for main actions and active states. It should often be applied as a subtle linear gradient (45deg) rather than a flat fill.
- **Accents:** Secondary and Tertiary colors are reserved for progress indicators, badges, and high-energy highlights.
- **Surface Strategy:** The system uses a tiered white approach. The main background is a very soft gray-blue (`#F8FAFC`), while interactive cards use pure white or translucent glass layers to pop forward in the hierarchy.

## Typography

**Plus Jakarta Sans** is the sole typeface for this design system, chosen for its modern geometric construction and friendly, open apertures. 

- **Weight Usage:** Use *ExtraBold (800)* for display headers to create a "squishy," impactful look. Use *SemiBold (600)* for subheaders to maintain readability without losing the brand's soft character.
- **Scale:** High contrast between header sizes and body text is encouraged to drive clear information hierarchy. 
- **Leading:** Line heights are intentionally generous (1.6x for body) to reinforce the "airy" feel of the design narrative.

## Layout & Spacing

The system utilizes a **Fluid-Responsive Grid** based on an 8px base unit. 

- **Desktop:** A 12-column grid with 24px gutters. Content should be centered within a 1440px max-width container, surrounded by generous 64px "breathing room" margins.
- **Mobile:** A 4-column grid with 16px gutters and 20px margins.
- **Spacing Philosophy:** Use the `stack-lg` (48px) unit frequently between major sections to prevent the UI from feeling "cramped." Layouts should prioritize vertical flow and use alignment to create "invisible lines" rather than relying on heavy borders or dividers.

## Elevation & Depth

Depth is the defining characteristic of this design system. It is achieved through three specific techniques:

1.  **Ambient Shadows:** Objects do not use "black" shadows. Instead, use highly diffused shadows tinted with the primary or neutral color (e.g., `rgba(99, 102, 241, 0.08)`). Shadows have a large blur radius (30px+) and a significant vertical offset to simulate a high floating position.
2.  **Backdrop Blurs:** Glassmorphic panels use a `blur(12px)` background filter combined with a semi-transparent white fill (`rgba(255, 255, 255, 0.7)`).
3.  **Inner Glows:** To make elements feel "tactile" and soft, apply a 1px white inner border (stroke) at 50% opacity. This mimics the highlight on the edge of a curved plastic or glass object.

## Shapes

The shape language is defined by **exaggerated roundness**. 

- **Cards & Containers:** Use `rounded-xl` (1.5rem / 24px) to create a friendly, organic frame for content.
- **Buttons & Inputs:** Use the pill-shaped approach for primary actions, while secondary inputs follow the `rounded-lg` (1rem / 16px) standard.
- **Clipping:** All media (images/videos) must inherit the container’s border radius to maintain the "Soft Tech" cohesion.

## Components

### Buttons
- **Primary:** Pill-shaped with a subtle 45-degree gradient (Primary to Secondary). On hover, the shadow should expand slightly and the brightness should increase.
- **Secondary:** Ghost style with a 1px soft-gray border or a very subtle tinted background.

### Input Fields
- Inputs should be tall (min 48px) with `rounded-lg` corners. Use a light gray background (`#F1F5F9`) that transitions to a white background with a primary-colored glow/shadow on focus.

### Cards
- Standard cards use a white background with a "Floating" shadow. 
- Feature cards use the Glassmorphism style with a `backdrop-filter: blur(12px)` and a subtle 1px white border.

### Chips & Badges
- Small, pill-shaped elements with low-opacity background fills (e.g., 10% opacity of the primary color) and high-contrast text.

### Progress Indicators
- Use soft, rounded bars with a gradient fill. The background track should be a very light version of the primary color to keep the visual "weight" light.