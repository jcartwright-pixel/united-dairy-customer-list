# Customer List

How to change this help: each part starts with `## Name`, then `id:` and `screens:` lines; numbered steps, `### Buttons`, `> ` for a tip and `!> ` for a "Do not" line. Plain words, made-up names only.

## Home
id: home
screens: index.html

The **United Dairy Customer List** is its own app. It keeps every customer, the routes and days they get a delivery, the run order and the truck load maps. Operations reads it: the Sales app's customers and the drivers' **Route Book** on their phones come from here. Sign in with the same United Dairy Google account as Operations.

1. Pick a screen from the tiles or the menu under the header.
2. Someone set up for more than one plant picks the plant in the header.

> The `? Help` button on every screen opens its own part of this guide.

## Customers
id: customers
screens: customers.html

The **United Dairy Customer List** (UDCL): the one list of every customer, the routes and days they get a delivery, and in what order. The Sales app and the drivers' route book read it from here. Each plant keeps its own list (Uniontown first).

1. Pick a tab: `By Customer` (one line per customer, with its days and every route and stop), `By Route` (each route and day with its stops in order) or `By Day` (each day with its routes).
2. Narrow it with **Find** (part of a name, account number, city, chain or distribution center), **Route**, **Day** and **Chain**. **Sort by** changes the order.
3. Tap a line to open the customer's card: **Distribution center**, address, phone, contact, **Keys or door code** and **Notes for the driver**. An Administrator or Manager can change them; each box saves when you leave it.
4. In `By Route` and `By Day`, `Open in Route Sequence` on a route's heading opens that route day to change its order.

### Buttons

- `+ Add Customer` (Administrators and Managers) adds a customer by account number and name. Then add it to a route day on **Route Sequence**.
- `Import Route Menu` (Administrators): pick the **Route Menu** workbook, and the **Route Book** too if you have it, then `Read and import`. The Route Menu's **Customer By Route** tab decides every customer, route, day and load sequence; its **Address List** and **GPS Address** tabs fill in addresses. The Route Book only fills in start times, run order, keys and instructions that are still blank, and its truck drawing where the numbers still match. `Bring over the Sales app list` copies the list already uploaded for the Sales app instead.
- `Print` opens the print menu: this list as shown, the route sequence sheets for the office, the drivers' route book pages, the list by route or by day, or the customers' addresses and phones.

> An import keeps what was typed here: run order, start times, instructions, load maps, addresses, phones, keys and notes. Run it again whenever the Route Menu changes.

> The **DC** column is the customer's distribution center code: 1 Martins Ferry, 6 Lancaster, 7 Fairmont, 9 Marietta, 30 Uniontown, 50 Charleston. A plant's own customers start with its code; change it on the card when a customer belongs to another center.

> **No address yet** in red means the Route Menu had no address for that account. Type it on the customer's card.

!> Do not import an old Route Menu. A route day that is not in the workbook is taken off, and its customers move to not active (shown crossed out).

## Route Sequence
id: route-sequence
screens: route-sequence.html

One route on one day, its stops in the order the driver runs them. This is where the office changes a route's order and prints it.

1. Pick the **Route**, then the **Day** (only the days the route runs can be picked).
2. Drag a stop up or down to its new place, or use the arrows. **Stop** is the run order.
3. **Load** is the stop's load sequence: where its product sits on the truck. Load 1 goes on first, at the front; the highest number is at the back door. Type a new number to change it.
4. **Stop note** is a note for this stop on this day (the customer's own notes, on its card, show on every day).
5. On the right: the **Start time**, the **Instructions for this route day**, `Add a stop` (pick a customer) and a small copy of the **Truck load map** (`Change the load map` opens it).
6. `Print` opens the print menu: this route day for the office, the driver's route book page (with keys, Time in and Time out boxes, the instructions and the load map), this route day's load map, every day of this route, every route on this day, or the whole route book.

- Only an Administrator or Manager can change the order. Everyone else can look and print.
- Every change saves by itself. If someone else changed the same route day a moment before, the screen says so and shows their change; make yours again.

> After you change a sequence, print the office sheet from the `Print` menu so the office has it. The drivers' phones show the new order at once (**Route Book**).

!> Do not leave a stop without a load sequence. The load map and the loaders need a number for every stop.

## Truck Load Map
id: load-map
screens: load-map.html

How the truck is loaded for one route day: the truck seen from above on the left (front at the top, the back door at the bottom; three spots on the left side and three on the right of each row) and the route day's customers on the right, in run order. Each spot shows a load sequence number, in the same colour as the customers with that number.

1. Pick the **Route** and the **Day**.
2. Pick a number under the truck, then tap a spot (or drag across several) to paint it. `Empty` clears spots.
3. `+ Row` and `- Row` make the truck longer or shorter. The side door box puts the **SIDE DOOR** mark between two rows.
4. `Rebuild from load sequence` starts the map again from the stops' load numbers (load 1 at the front, each number given rows by how many stops have it).
5. `Print` opens the print menu: this load map with its customers, every load map for the day, or every day of the route.

- A new route day starts from the 2024 Route Book's drawing when its numbers still match, otherwise it is built from the load sequence.
- Only an Administrator or Manager can change the map. Every change saves by itself.

!> Do not change a stop's load number here. Change it on **Route Sequence**; then press `Rebuild from load sequence` or repaint its spots.

## Load Map Kiosk
id: load-map-kiosk
screens: load-map.html?kiosk=1

The Truck Load Map for the plant's kiosk station: the load diagram on one side and the customers on the other, big enough to read from the dock. Nothing can be changed from it.

1. Open **Load Map Kiosk** on the plant's screen and press `Full screen`.
2. Today is picked by itself. Tap a day to look at another.
3. Tap a route's big button to show its truck and customers.

- It reads the list again every 2 minutes, so a change the office makes on Route Sequence or Truck Load Map shows on the floor by itself.
- `Print` prints this load map for the loader.

