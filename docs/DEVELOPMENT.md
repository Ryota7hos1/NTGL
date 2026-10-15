# Development log

How this prototype got to where it is: each request I made, in order, what changed, and why. The product decisions behind the current version are summarised in the [README](../README.md); this is the path that led to them.

The git history groups these steps into milestone commits (listed at the end). Those commits were made after the fact by replaying the changes in order, so their dates are not the dates the work happened.

---

## Starting point

**1. Run the existing prototype.** A static, five-tab mock-up (site model, procedure writing, review, telemetry, and a "Spares" idea tab) served by a small Python file server.

**2. Keep only the Spares (idea) tab.** The other four tabs restated what Entangl already does. The spares idea was the part worth developing, so everything else was cut.

**3. Decide what the demo needs to show.** The demo is for a full-stack engineer application. A static page shows little engineering, so the plan became: a real backend, logic computed from data rather than hard-coded, a README, and eventually a deployment.

## A real backend

**4. Node backend.** Express API with SQLite (Node's built-in driver, so nothing native to compile). Parts, supplier requests, bids and an audit log; part status computed from install date and service life; a request flow of draft → approved and sent → awarded; API tests with Node's test runner.

**5. Header controls.** "Acting as" and "Reset demo data" moved to the top right.

**6–7. Parts as boxes.** Each part became its own box; equipment and service-life details moved into a dropdown, and the whole box became clickable.

## From a pipeline to buying

**8. Replace the three-step pipeline.** Draft → send → award didn't match how anyone buys a part. Requests now generate supplier quotes immediately; each supplier has an Order button leading to an order screen and a confirmation.

**9. Price history.** Added purchase history per part, the last price paid, a "Previous supplier" tag, each quote's price change against last time, and an "Already purchased" button to close a request bought elsewhere.

**10. Entangl's look.** Colours, type and button style taken from entangl.com: deep green header, off-white page, lime accent, light and dark mode.

**11. Light/dark toggle (question).** The page follows the system setting; no toggle was added.

**12–13. Every part can be ordered.** Not only parts that are due. Quote prices are now based on each part's own last purchase price instead of fixed battery prices. All "Get supplier quotes" buttons use the primary style.

## Seeing the whole site

**14. Orders & activity page.** The audit trail moved off the supplier and order screens into its own page, with a list of every part ordered and every logged action.

**15. Site tab.** A static isometric drawing of the facility in the style of Entangl's homepage. Every machine in it is equipment from the parts list. Kept static (no 3D or animation) to keep it cheap to run. Equipment became its own table.

**16. Machine popup.** Clicking a machine opens a popup with its parts and a link to them.

**17. Equipment tab.** The Parts tab became an Equipment tab: every machine with its parts in a dropdown, and any red or yellow part also pinned at the top under "Needs attention".

**18. Ordering resolves a part.** Once a due part has a replacement ordered (or bought elsewhere) inside its current warning window, it leaves "Needs attention" and shows "Replacement ordered".

**19. Suppliers page.** "Get supplier quotes" opens its own Suppliers page instead of a box on the Equipment tab.

## Failure and history

**20. Destroy (demo only).** A button in the machine popup makes a part fail on demand, so the failure path can be shown. The failure is logged.

**21. Clearer popup.** The popup separates the machine (a dark "Equipment" header) from its parts (bordered "Part" rows with status-coloured edges).

**22. Failure updates the dates.** A failed part's end of life moves to the failure date; the rated date is kept alongside, with how many days early it failed.

**23. Previous service life.** Each part can record how long its previous unit lasted. Nearing that age makes a part due ("Due · approaching previous service life"), and the service life shows "X days until it broke last time". It only ever triggers Due; it is never its own status.

## Recommending a supplier

**24. Recommendation engine.** A server-side engine ranks quotes on delivery, exact part match and price, weighted by urgency: a failing part favours speed, a planned purchase favours exact match and price. Quotes gained an exact or compatible-alternative flag, and a fourth supplier (fast, expensive) was added so there is a real trade-off.

**25–26. Keep the list simple.** The ranked list with scores and reasons cluttered the page, so the supplier list went back to its original look, and the "What the site needs" panel was removed. The engine still decides the order.

**27. Delivery shouldn't dominate.** If a part arrives before end of life, how fast it arrives shouldn't matter, unless it is drastically slower than the others (more than a year longer, or ten times as long).

**28. Measure delivery against end of life.** That comparison should use how many days before end of life each delivery lands, not the lead time itself.

**29. Price decides between equals.** Between exact parts that all arrive on time, the cheapest wins. Sorting now uses the unrounded score with price as the tie-break.

**30. The previous supplier is an exact match.** A supplier that provided the part before can supply the same part again.

## Fitting how sites actually buy

**31. Link out instead of a checkout.** Sites buy critical spares through their own purchasing systems, so the in-app order and confirmation screens were removed. Each supplier now has "Go to supplier" (a placeholder link in the demo) and "Mark as ordered", which records the PO and delivery date so the part, price history and log stay current.

**32. Already purchased, recorded properly.** It now uses the same kind of form: supplier, optional total paid, optional PO, and delivery date. It is saved as an order and, with a price, updates the last purchase.

**33. Checking the fit with Entangl (question).** Their site lists maintenance planning as planned and service procurement as a planned concept. The demo is framed as my take on those, extended to spare parts.

**34. Link to a procedure.** Every request links to a draft replacement procedure built from the part, machine, site documents and order, with steps needing an engineer's input flagged. This ties the idea back to procedure generation, which is what Entangl sells today.

**35. README.** Problem, users, fit with Entangl, walkthrough, product decisions, architecture, API, how to run it, and what I'd do next.

**36. Due rule based on delivery.** A part is due within 90 days of its rated end of life, or when ordering today from the previous supplier would arrive within 30 days of its rated end of life or of the age the last unit failed at. A slow supplier makes a part due sooner.

---

## Milestone commits

| Commit | Covers steps |
|---|---|
| Original static prototype | 1 |
| Narrow the prototype to the spares idea | 2 |
| Add Node backend with SQLite and API tests | 3–7 |
| Replace the request pipeline with supplier quotes and ordering | 8–13 |
| Add Orders & activity page and Site tab | 14–16 |
| Add Equipment tab, failures and previous service life | 17–23 |
| Add supplier recommendation engine | 24–30 |
| Link out to suppliers, procedures, due rule and README | 31–36 |
