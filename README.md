# MCQ Café — Point of Sale System

A complete, professional POS for **MCQ Café** (Vietnamese street kitchen). It runs
entirely in the browser — **no install, no server, no build step**. Open
`index.html` and start selling.

```
Design POS system for MCQ cafe/
├── index.html                ← open this in any modern browser
├── assets/
│   ├── css/styles.css        ← the premium charcoal + gold theme
│   └── js/
│       ├── data.js           ← menu catalog, promotions, default config
│       ├── store.js          ← state, persistence, pricing & order engine
│       └── ui.js             ← all screens and interactions
└── README.md
```

> **Tip:** double-click `index.html`, or for the smoothest experience run a tiny
> local server from this folder: `python3 -m http.server 8080` then visit
> `http://localhost:8080`.

---

## What's included

| Area | Capabilities |
|---|---|
| **Register (POS)** | 11 categories, 72 items, live menu search, big touch cards, one-tap add, quantity steppers, per-category section headers. Bánh Mì items are auto-labelled "… Bánh Mì" on tickets so the kitchen never confuses them with the rice/noodle version. |
| **Customize sheet** | Per-line **✎ Customize**: **paid add-ons** (Pâté, Egg, Roast pork, Extra rice, etc. with qty steppers — added to the bill), **free preferences** (No coriander, Cut in half, Change gloves for vegetarian, No mayo/soy/pickle, Extra soy/fish sauce…) and a free-text kitchen note. |
| **Order types** | Dine-in (table #) and Take-away (customer name). |
| **Promotions (date-aware)** | Rules with **start/end dates**: each promo is *Active / Scheduled / Expired / Disabled* and only **Active** ones apply at checkout. Default **15% OFF Bánh Mì** (excl. MCQ Special Sizzling Beef & combos). Admin manager + a **cashier promotions panel & banner** showing what's running and until when — to bill correctly alongside marketing campaigns. |
| **Combos** | Guided combo builder: pick the Bánh Mì + the drink/coffee; fixed combo price; no promo stacking. |
| **Discounts** | Optional order-level discount (percent or fixed amount) applied *after* the auto promo, for staff meals / comps / loyalty. |
| **Payments** | Multi-tender (split) Cash / Card / Other. Cash keypad with quick denominations + auto change. **Card runs a simulated EFTPOS terminal flow** (amount pushed to terminal → waiting → Approved). |
| **Receipts** | Branded, printable receipt (with logo) showing add-ons, preferences, itemised discounts, tax, tender, change & refund history. |
| **Refunds / Returns** | Full or **partial (per-item) refunds** with required reason, refund method, proportional amount (returns discount/tax fairly), printed refund voucher, and status tracking (`partial-refund` / `refunded`). Separate **Void** for mistakes. |
| **Parked tickets** | Hold an order and recall it later — great for busy counters. |
| **Orders / History** | Look up by order #, table or name across all days; one-tap reprint; "Reprint last" in the top bar; refund or void with audit trail. |
| **Dashboard** | KPIs (net sales, avg order, refunds, discounts, tax, dine-in vs take-away), sales by category, payment mix, top sellers. **Any date range** + quick ranges, **category filter**, and **export to PDF & Excel**. |
| **Menu Manager** | Three tabs — **Menu Items** (edit prices inline, enable/disable, add/edit/delete, flags), **Add-ons & Notes** (full CRUD of modifier groups & options + prices), **Promotions** (create/edit campaigns with dates). |
| **Settings** | Store details, **logo upload**, currency, tax rate + label, tax-inclusive toggle, cash rounding, receipt footer, cashier, promo toggles, **export / import / reset** data. |

All data is saved to the browser's `localStorage` and survives refreshes. Use
**Settings → Export** to back up or move to another device. On upgrades, a small
seed-migration updates store details and adds newly-shipped items/options without
touching your orders or custom edits.

---

## The pricing logic (how totals are built)

Computed in `store.js → computeTotals()`, in this exact order:

```
0. Unit price         = base item price + Σ paid add-ons (per unit)
1. Subtotal (gross)   = Σ (unit price × qty) at full price
2. Promotions         = % off each eligible line — applied to the BASE price
                        only, never to paid add-ons
                        ─ only promos whose status is "Active" today apply
                        ─ Bánh Mì promo excludes "MCQ Special Sizzling Beef"
                        ─ excludes combos
3. After promo        = gross − promo
4. Manual discount    = percent or fixed amount, applied to (after promo)
5. Net                = after promo − manual discount
6. Tax (GST):
      • inclusive mode → total = net;  tax = net − net ÷ (1 + rate)
      • exclusive mode → tax = net × rate;  total = net + tax
7. Cash rounding      = optional rounding of the final total (e.g. AU 5c)
```

The promotion engine is **rule-driven** (`data.js → PROMOTIONS`, editable in the
Promotions tab). A rule of type `category_percent` carries: the target
`category`, the `percent`, an `excludeItemIds` list, an `excludeCombos` flag and
**`startDate` / `endDate`**. `store.js → promotionStatus()` derives
*active / scheduled / expired / disabled* from today's date, and only **active**
rules discount any line — so a campaign automatically switches on and off on its
dates with no staff action.

### Worked example
`Traditional Pork ($7)` + `MCQ Special Sizzling Beef ($15)` + `Bánh Mì + Drink combo ($8)`

```
Subtotal            $30.00
Bánh Mì promo       −$1.05   (15% of $7 only — sizzling & combo excluded)
GST 10% (incl.)      $2.63
TOTAL               $28.95
```

---

## Data model (quick reference)

**Menu item** (`data.js`)
```js
{ id, cat, name, price,
  noDiscount?, takeawayOnly?, available?,   // flags
  isCombo?, combo? { slots:[{ label, from:[catIds] }] } }
```

**Promotion** (`data.js → PROMOTIONS`, editable in-app)
```js
{ id, name, type:'category_percent', category, percent,
  excludeItemIds:[], excludeCombos, startDate, endDate, active, note }
```

**Modifier group** (`data.js → MODIFIER_GROUPS`, editable in-app)
```js
{ id, name, free,                      // free = no charge (preference/note)
  appliesTo:{ all? | categories:[...] | items:[...] },
  options:[{ name, price? }] }         // price only for paid add-ons
```

**Completed order** (`store.js`) keeps a full snapshot: lines (with base price,
add-ons, preferences, per-line discount + promo name), totals, the discount used,
every payment tender, change given, refund records and status
(`paid` / `partial-refund` / `refunded` / `voided`) — so receipts reprint
identically and reports stay accurate even if prices change later.

---

## Editing the menu / prices

- Quick price change → **Menu** tab, type the new price (saves on blur).
- Sold out → **Disable**; it greys out on the register and can't be added.
- New item → **+ Add item** in any category.
- Bulk / structural changes → edit the `MENU` array in
  [assets/js/data.js](assets/js/data.js) and **Settings → Reset** to reseed.

---

## Keyboard & touch

- Built for touch (tablets) and mouse alike.
- `Esc` closes any open dialog.
- Fully responsive — on a phone the register switches to menu-first.

Enjoy — *Xin cảm ơn!* 🌸
