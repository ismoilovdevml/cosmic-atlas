# Fact check: concept and kind articles

Every number used in the concept and kind articles under `web/public/docs/{uz,en,ru}/` and the source
it was taken from. The three languages state the same facts. "Atlas" sources are this repository's
own data (catalogues in `data/tiles/catalogs/`, `data/raw/*/PROVENANCE.json`) or code. "Computed"
means arithmetic on the cited values (shown in the claim column). Sources were opened on 2026-11-13.

## Re-check log

See the end of this file for the sources re-opened after writing.

## Table

| slug | claim | value | source |
|---|---|---|---|
| how-to-use | wheel zoom per notch | about 1.25× | web/README.md (Controls) |
| how-to-use | fly faster with Shift | 4× | web/README.md (Controls) |
| how-to-use | point budget range, default | 0.5–12 M, 4 M | web/index.html (`#budget`), web/README.md |
| how-to-use | thin slab half-thickness range | ±10 to ±300 Mpc | web/index.html (`#slab`), web/README.md |
| how-to-use | scale rail range | about 0.04 au to 30 Gpc | web/src/ui/rail.ts (RAIL_MIN = log10(2e-7 pc), RAIL_MAX = log10(3e10 pc)) |
| how-to-use | scale tour stops | 6 | web/src/tour/tours.ts (SCALE_TOUR) |
| how-to-use | distance range on card | 16th–84th percentile | web/src/main.ts, docs/data-contract.md §2 |
| how-to-use | languages | uz, en, ru via ?lang= | docs/content-contract.md §1 |
| index | slug list | 27 concept/kind + 13 Solar System + 9 highlights | docs/content-contract.md §4 |
