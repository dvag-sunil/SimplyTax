# SimplyTax - Mobile Compatibility Audit

## Standards applied (checked against current sources)
- Viewport meta `width=device-width, initial-scale=1`, zoom never disabled (WCAG 1.4.4)
- Touch targets: WCAG 2.2 AA floor 24px (2.5.8); Apple HIG 44pt; Material 48dp. Built to 44px.
- Form fields at least 16px, otherwise iOS Safari zooms the page on focus
- No horizontal scrolling, no clipped content; 320px is the standard stress width
- Text not below 11px (decorative badge) and body text at 14px or more

## Device matrix (CSS px)
Portrait: 280 (folded phones), 320 (iPhone 5/SE1), 360 (most common Android), 375 (iPhone 6-X), 390, 412, 430, 768 and 834 (tablets).
Landscape: 568x320, 667x375, 844x390, 915x412, 1024x768.

## Result
| Surface | Scans | Before | After |
|---|---|---|---|
| Static pages (home, AGB, Datenschutz, Impressum, scope, ELSTER guide, Steuerwissen), both languages | 210 | many failures | 0 failures |
| App: login, register, forgot, dashboard | 60 | 0 clean | 0 failures |
| App: all 12 client steps | 180 | 0 clean | 0 failures |
| App: modals (new client, new year, certificate, settings, submit review) | 90 | 0 clean | 0 failures |

Backend suites unchanged and passing: xml-builder 301/301, fieldmap 303/303.
Earlier features re-verified after the changes: submission lock, copy-year, single-parent section, spouse profession in the payload.

## Real defects found and fixed
**App**
1. Page scrolled sideways after landing on later steps (logo cut off, no way back). Cause: `scrollIntoView({inline:'center'})` scrolls the page itself, and html/body were `overflow-x:hidden`.
2. Dashboard clients table clipped at tablet widths (920px table); row actions unreachable. Now stacked cards up to 980px.
3. Right-hand refund meter pushed off-screen on iPad landscape (1024px) and the stepper/panel blown wider than the phone at 280px: CSS grid `1fr` blowout. Fixed with `minmax(0,1fr)`.
4. Earlier 44px tap-target fixes were being undone by later rules in the same media blocks. Replaced with one consolidated baseline block.
5. Search box and filters at 13px / 12.5px (iOS focus-zoom). Now 16px.
6. Tap targets under 24px: login links, portal link, row actions, summary rows, energy-measure checkboxes, info bubbles. All now 44px hit areas.
7. 9-10.5px text (BETA badge, stepper labels). Now 11px.
8. Modals: `max-height:90vh` can push buttons off-screen on iOS Safari. Now relative to the fixed overlay.
9. Phone header took three rows (about 170px, sticky). Now two rows, scrolls away on phones.
10. `inset:` shorthand collapses modals on iOS before 14.1. Replaced with longhand.
11. Blank page on browsers without optional chaining. Now a clear "please update" message; a soft notice where flexbox gap is missing.

**Static pages**
1. Long German words ("Allgemeine Geschaeftsbedingungen") overflowed 320px screens (text overflow, invisible to box measurements).
2. Nav bar overflowed below about 330px; controls were 36px with 11px text.
3. Back links, footer links, FAQ rows 17-25px tall.
4. "What's supported" grid forced two columns and overflowed at 280-320px.

**Introduced by me and caught by re-measuring (all fixed)**
- A touch-device nav rule re-showed links hidden behind the hamburger.
- `flex:1 1 0` on the user name squeezed it to 18px.
- `overflow-wrap:anywhere` split short labels mid-word ("Nam/e"). Reverted to `break-word`.
- An earlier 'pre-existing' diagnosis of that split was wrong (flawed test); the original had no such split.

## Browser baseline (from a code scan)
- Optional chaining used about 65 times: needs iOS Safari 13.4 / Chrome 80 or the app cannot start.
- Flexbox gap about 59 times: needs iOS Safari 14.1 / Chrome 84 or spacing disappears.
- Practical full-fidelity floor: iOS 14.5, Chrome 87, Samsung Internet 14, Firefox 90. Every iPhone from 2015 on (6s, 7, SE) can run iOS 15, so a decade of phones is covered. iPhone 5s/6 (stuck on iOS 12) show the update message.

## Limits - please read
- Only Chromium could be run here. Firefox and WebKit (Safari) downloads were blocked. Layout was tested with mobile emulation (touch, device pixel ratio, mobile viewport handling), not real Safari or Firefox rendering.
- No real devices. A short pass on a real iPhone (Safari) and a real Android (Chrome, Samsung Internet) is recommended before launch, especially: keyboard behaviour on the date fields, the sticky/scrolling header, and PDF/file upload pickers.
- Colour contrast and screen-reader behaviour were not part of this audit.
- Remaining soft items: at 320px the tax ID in the review summary can wrap onto two lines; the narrowest phones show a three-row header.

## Re-running the audit
`mobile_audit.py` and `app_states.py` are included. From the project folder: `python3 mobile_audit.py static portrait`, `python3 mobile_audit.py app_steps landscape`, etc. (needs Playwright). They can be added to CI.
