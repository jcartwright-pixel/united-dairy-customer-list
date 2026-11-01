# United Dairy Customer List (UDCL)

The one list of United Dairy's customers: who gets a delivery, on which route and day, in what order, and how the truck is loaded.
Its own app (Joe, 11-1-26: "keep it separate"), in the same Firebase project as Operations (UDPO), so the same United Dairy
Google sign-in and Users list apply.

## Screens (`public/`)

- **Customers** (`customers.html`): by customer, by route, by day; find, filters, sort; a customer's card (address, phone,
  distribution center, keys, notes); Import Route Menu (administrators); Print menu.
- **Route Sequence** (`route-sequence.html`): one route day's run order, load numbers, stop notes, start time, instructions.
- **Truck Load Map** (`load-map.html`) and the **Load Map Kiosk** (`load-map.html?kiosk=1`) for the plant floor.
- **Help** (`help.html`, words in `public/help.md`). Every screen change also changes its part of `help.md`.

## Data (Firestore, the project's main database)

- `udclCustomers/<plant>__<account>`, `udclRouteDays/<plant>__<route>__<DAY>`, `udclLog/<id>`, `private/udcl_<plant>`.
- The screens never read the database directly: everything goes through one server call, `customerList` (`functions/`,
  functions group `udcl`, region us-east4). So this app deploys no database rules; Operations owns those.

## The bridges

Operations reads the same records: its Sales app's customers and the drivers' Route Book on their phones. UDMS (driver
qualification) has no customer data.

**No customer data goes in this repository.** It is public. The Route Menu workbook is imported on the Customers screen.

## Deploy

The sandbox and live deploys run from Operations' Deploy workflow (it holds the Firebase deploy keys). It checks out this
repository and deploys `hosting:udcl` and `functions:udcl` to the site `<project>-customers` (made the first time).

## Tests

    cd functions && npm install && npm test && npm run test:browser
