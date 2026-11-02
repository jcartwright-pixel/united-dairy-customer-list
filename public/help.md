# Customer List

How to change this help: each part starts with `## Name`, then `id:` and `screens:` lines; numbered steps, `### Buttons`, `> ` for a tip and `!> ` for a "Do not" line. Plain words, made-up names only.

## Home
id: home
screens: index.html

The **United Dairy Customer List** is its own app. It keeps every customer, the routes and days they get a delivery, the run order and the truck load maps. Operations reads it: the Sales app's customers and the drivers' **Route Book** on their phones come from here. Sign in with the same United Dairy Google account as Operations.

1. Pick a screen from the tiles or the menu under the header. **Administration** shows only to administrators.
2. Someone set up for more than one plant picks the plant in the header.

3. To get the Customer List as its own app on your computer (its own window and icon, like the Operations app), press `Install the app` on Home in Chrome or Edge, or use the install icon at the right end of the address bar.

> The `? Help` button on every screen opens its own part of this guide.

> When a new version of the Customer List is out, a yellow **Update ready** line shows under the header on every open screen (and in the installed app). Press `Refresh` to get it. The Load Map Kiosk refreshes by itself.

## Customers
id: customers
screens: customers.html

The **United Dairy Customer List** (UDCL): the one list of every customer, the routes and days they get a delivery, and in what order. The Sales app and the drivers' route book read it from here. Each plant keeps its own list (Uniontown first).

1. Pick a tab: `By Customer` (one line per customer: chain, account, customer, distribution center, address, then a column for each day from Sunday to Saturday showing the route that delivers that day), `By Route` (each route and day with its stops in order) or `By Day` (each day with its routes).
2. Narrow it with **Find** (part of a name, account number, city, chain or distribution center), **Route**, **Day** and **Chain**. **Sort by** changes the order.
3. Tap a line to open the customer's card: **Distribution center**, address, phone, contact, **Keys or door code** and **Notes for the driver**. An Administrator or Manager can change them; each box saves when you leave it.
4. In `By Route` and `By Day`, `Open in Route Book` on a route's heading opens that route day to change its order.

### Buttons

- `+ Add Customer` (Administrators and Managers) adds a customer by account number and name. Then add it to a route day on **Route Book**.
- `Import Route Menu` (Administrators): pick the **Route Menu** workbook, and the **Route Book** too if you have it, then `Read and import`. The Route Menu's **Customer By Route** tab decides every customer, route, day and load sequence; its **Address List** and **GPS Address** tabs fill in addresses. The Route Book's run order, start times, keys and instructions replace what is here, and so does its truck drawing where the numbers still match. `Bring over the Sales app list` copies the list already uploaded for the Sales app instead.
- `Print` opens the print menu: this list as shown, the route sequence sheets for the office, the drivers' route book pages, the list by route or by day, or the customers' addresses and phones.

> A new upload overrules everything changed here: whatever the workbooks have wins. Changes made in the app stay until the next upload, and nothing else puts them back. What the workbooks do not have stays as typed (phones, contacts, notes, stop notes, and the run order and load maps when no Route Book is picked).

> When you send changes to the office, upload again only once the office has put them in the Route Menu, so the upload carries them.

> The **DC** column is the customer's distribution center code: 1 Martins Ferry, 6 Lancaster, 7 Fairmont, 9 Marietta, 30 Uniontown, 50 Charleston. A plant's own customers start with its code; change it on the card when a customer belongs to another center.

> **No address yet** in red means the Route Menu had no address for that account. Type it on the customer's card.

!> Do not import an old Route Menu. A route day that is not in the workbook is taken off, and its customers move to not active (shown crossed out).

## Route Book
id: route-sequence
screens: route-sequence.html

One route on one day, its stops in the order the driver runs them. This is where the office changes a route's order and prints it.

1. Pick the **Route**, then the **Day** (only the days the route runs can be picked).
2. Each line shows **Run Seq**, **Load Seq**, the **Chain**, the **Account** and the **Customer** name. Drag a stop up or down to its new place, or use the arrows. **Run Seq** is the run order: the order the driver delivers.
3. **Load Seq** is the stop's load sequence: where its product sits on the truck. Load 1 goes on first, at the front; the highest number is at the back door. Type a new number to change it; the truck load map's spots with the old number change to the new one.
4. **Stop note** is a note for this stop on this day (the customer's own notes, on its card, show on every day).
5. `Edit` on a stop opens its edit box. On the left are two parts. **Days on route …**: untick a day to take the stop off this route on that day only, or tick a day to add it to this route, then press `Save`. **Move to another route**: pick the route in **To route**, tick the days to move (the day you are looking at is ticked), and press `Move to route …`. It comes off this route on those days and goes on the new route, placed by its load sequence; its other days stay here. On the right: the **Note for this stop** (this route and day only) and the **Notes for the driver** (every day). `Take off route …` (press it twice) takes the customer off this route on every day.
6. On the right: the **Start time**, the **Instructions for this route day**, `Add a stop` (pick a customer) and a small copy of the **Truck load map** (`Change the load map` opens it).
7. `Load Map` opens the truck load map in its own window: the truck, the customers and their load sequence, nothing else. Change the run order, a load sequence or the truck there, and this screen shows it at once (and the other way round).
8. `Print` opens the print menu: this route day for the office, the driver's route book page (with keys, Time in and Time out boxes, the instructions and the load map), this route day's load map, every day of this route, every route on this day, or the whole route book.

- Only an Administrator or Manager can change the order. Everyone else can look and print.
- Every change saves by itself. If someone else changed the same route day a moment before, the screen says so and shows their change; make yours again.

> A stop added to a day goes in by its load sequence (after the stops with the same or a higher number). Drag it if it belongs somewhere else.

> After you change a sequence, print the office sheet from the `Print` menu so the office has it. The drivers' phones show the new order at once. This screen, Truck Load Map and the drivers' phones all show the same route days, so a change on one shows on the others.

!> Do not untick a day to move a customer to another route: unticking only takes it off this route. Use **Move to another route** instead.

!> Do not leave a stop without a load sequence. The load map and the loaders need a number for every stop.

## Truck Load Map
id: load-map
screens: load-map.html

How the truck is loaded for one route day: the truck seen from above on the left (front at the top, the back door at the bottom; three spots on the left side and three on the right of each row) and the route day's customers on the right, in run order. Each spot shows a load sequence number, in the same colour as the customers with that number.

1. Pick the **Route** and the **Day**.
2. On the right, **Run Seq** is the order the driver delivers. Grab a customer's line and drag it up or down to change it.
3. **Load Seq** is where the customer's product sits on the truck. Type a new number in its box; the spots on the truck with the old number change to the new one.
4. Pick a number under the truck, then tap a spot (or drag across several) to paint it. `Empty` clears spots.
5. `+ Row` and `- Row` make the truck longer or shorter. The side door box puts the **SIDE DOOR** mark between two rows.
6. `Rebuild from load sequence` starts the map again from the stops' load numbers (load 1 at the front, each number given rows by how many stops have it).
7. `Print` opens the print menu: this load map with its customers, every load map for the day, or every day of the route.

- A new route day starts from the 2024 Route Book's drawing when its numbers still match, otherwise it is built from the load sequence.
- Only an Administrator or Manager can change the order, the load sequence and the map. Every change saves by itself, and shows on Route Book and on the drivers' phones too.
- A new upload of the Route Menu replaces the load sequence, and the Route Book's run order if it is picked.

!> Do not give two different stops' products the same spot by mistake: after changing a load number, check the truck still matches, or press `Rebuild from load sequence`.

## Load Map Kiosk
id: load-map-kiosk
screens: load-map.html?kiosk=1

The Truck Load Map for the plant's kiosk station: the load diagram on one side and the customers on the other, big enough to read from the dock. Nothing can be changed from it; change the order and load sequence on **Truck Load Map** or **Route Book**.

1. An administrator opens it from **Administration** > `Load Map Kiosk`, on the plant's screen, and presses `Full screen`.
2. Today is picked by itself. Tap a day to look at another.
3. Tap a route's big button to show its truck and customers.

- It reads the list again every 2 minutes, so a change the office makes on Route Book or Truck Load Map shows on the floor by itself.
- `Print` prints this load map for the loader.
- `Administration` (administrators only) goes back to Administration.

## Administration
id: administration
screens: administration.html

For administrators only (it is not in the menu for anyone else).

1. `Load Map Kiosk` opens the plant floor kiosk view, to see how it looks. Nothing can be changed from it.
2. `Import the customer list` goes to **Customers**, where `Import Route Menu` uploads the workbooks.
3. Under the tiles: when the last upload was, by whom and from which file.

!> Do not upload an old Route Menu. A new upload overrules the changes made here.

