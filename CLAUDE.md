# Master context (read first)

This app is one of the United Dairy apps. The source of truth for how they fit together, who owns which data and which
chat may change which repository is `jcartwright-pixel/united-dairy-master`: `MASTER.md` and
`projects/customers-udcl/CLAUDE.md`. Read both before changing anything here. If the master repository is checked out
next to this one, these lines load them:

@../united-dairy-master/MASTER.md
@../united-dairy-master/projects/customers-udcl/CLAUDE.md

Anything this app needs from another app goes in that repository's `REQUESTS.md`, never as code in the other app.

# United Dairy Customer List (UDCL)

- This repository is public: **no customer data in it, ever.** The Route Menu workbook is imported on the Customers screen.
- The Customer List is the Route Master source of truth for stores, routes, days, stop order and load order (Joe 11-8-26).
- Screens never read the database directly; everything goes through the one server call `customerList`.
- The bridge to Route Cost Analysis (Joe 11-9-26): this app writes `udclRouteMaster/<plant>` (active customers only, every stop in run order) after every change, and the Customers screen brings it up to date when it finds it behind. Route Cost reads it and never writes it.
- Any change to what a person sees on a screen also changes that screen's part of `public/help.md` in the same pull request.
- Plain words on screens, dates like 11-8-26, United Dairy look, no pop-ups. Made-up names only in tests and pictures.
- This app deploys no database rules; Operations owns those.
