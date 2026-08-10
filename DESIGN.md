# Currency And Metals Converter Design

## Product Register

Product utility. The interface prioritizes fast, accurate conversion entry and clear reading of results on both desktop and mobile.

## Layout

- A single centered converter surface keeps the two tools focused and avoids dashboard clutter.
- The top row contains route navigation, theme control, and language selection. It wraps on small screens without hiding any controls.
- Form fields use a two-column grid from the `md` breakpoint and a single vertical flow below it.
- Currency targets are discrete, bordered blocks. This makes multiple comparisons easy to scan, add, and remove without losing the relationship to the base currency.
- Results use a right-aligned numeric treatment and separated rows, allowing values and exchange rates to be compared quickly.

## Colour And Contrast

The application has explicit light and dark themes. The active choice is stored in `localStorage` as `app_theme`.

### Dark Theme

- Page: navy `#0b1630`.
- Surface: navy-slate `#14213d`.
- Primary text: pale blue-white `#f4f7ff`.
- Muted text: pale blue-grey `#c4cee2`.
- Borders: high-visibility blue-grey `#7d91b8`.
- Action accent: sky blue `#79d6ff`, paired with dark navy text `#071427`.

### Light Theme

- Page: pale blue `#edf3fb`.
- Surface: white `#ffffff`.
- Primary text: deep navy `#13233b`.
- Muted text: blue-grey `#425675`.
- Borders: visible blue-grey `#7185a5`.
- Action accent: deep blue `#075e99`, paired with white text.

Both themes define the same semantic roles in `src/themes/dark.css` and `src/themes/light.css`: `page`, `surface`, `surface-raised`, `field`, `ink`, `muted`, `hint`, `placeholder`, `border`, `accent`, `accent-hover`, `nav-active`, feedback roles, focus, selection, and shadow. Components reference roles only; colour literals belong in the theme files.

## Controls

- Currency target fields use Chakra `Combobox` controls for keyboard-accessible search and mobile-safe, height-limited result lists.
- A target list excludes the base currency and currencies already selected in other target fields before searching or selecting.
- Base currency, metal, metal currency, and units use native Chakra selects so mobile users receive their platform picker.
- The language menu uses bundled SVG country flags with a text label. Flags are a visual cue, not the only language identifier.
- The Chakra `Switch` indicates the active theme and persists the selection across visits.

## Typography And Motion

- Georgia is reserved for the converter title and primary metal result, giving important outcomes a more editorial hierarchy.
- System sans-serif text is used for labels and controls for legibility.
- Currency codes use a monospace stack to make code and numeric result rows easier to scan.
- The converter surface has one short entrance animation. Interaction should not depend on motion.
