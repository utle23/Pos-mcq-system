# MCQ Café POS — Documentation

Documentation for the MCQ Café Point of Sale system — one guide for end users,
one for the engineering / IT team.

| File | Audience | What it is |
|------|----------|------------|
| **[MCQ-Cafe-POS-User-Guide.pdf](MCQ-Cafe-POS-User-Guide.pdf)** | Staff & managers | The full user guide (A4, full-size screenshots) — how to run the register, kiosk, reports, and the screen-media managers. |
| **[MCQ-Cafe-POS-Technical-Handover.pdf](MCQ-Cafe-POS-Technical-Handover.pdf)** | IT / developers | Technical handover & developer guide — architecture, data layer, front-end, the media subsystem, security, testing, deployment, and the production roadmap. |
| `USER_GUIDE.html` | — | Source of the user guide. Open in a browser → **Print → Save as PDF** to regenerate. |
| `TECH_GUIDE.html` | — | Source of the technical handover. Same regeneration steps. |
| `img/` | — | Screenshots used in the user guide. |

## User guide covers

Accounts, passwords & access rights · the Register (taking orders) · customising
items & combos · discounts & held tickets · payments (cash / card / split) ·
receipts · promotions · transaction history, refunds & voids · dashboard &
reports · menu manager · settings · the admin hub · customer display · the
Standing Order Tree self-service kiosk · loyalty & membership · **screen media &
advertising (ads, login & customer-display managers, neon attract frame)** ·
data, storage & backup · troubleshooting.

## Technical handover covers

System overview & architecture · technology stack & design methodology ·
repository & file structure · the data layer (localStorage + IndexedDB) & schema ·
state management & rendering model · core domain logic · screens & components ·
the kiosk state machine · the media subsystem · security & access control ·
testing & QA · performance engineering · build, deployment & operations ·
extending the system · known limitations & production roadmap.

> Default logins (change before going live): **Manager** PIN `1234`,
> **Cashier 1** PIN `1111`, **Cashier 2** PIN `2222`.
