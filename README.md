# Spares & end-of-life: a concept for Entangl

A working prototype of how parts replacement could fit into [Entangl](https://www.entangl.com): see which machines on a site have parts that are failing or due, compare suppliers for the replacement, record the order, and hand off to a replacement procedure.

> **Unofficial.** This is a proposed extension built for a job application, not an Entangl product. All sites, drawings, parts, suppliers and prices are fictional.

How it got here, request by request: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

---

## The problem

A data center is full of parts that wear out: battery jars, fan kits, filters, capacitors. Manufacturers publish rated service lives, but real lifespans vary with temperature, load and maintenance. The information needed to decide when to replace a part and where to buy it can sit in several places: the rated life in a datasheet, quotes and supplier details in email or a purchasing system, and the record of how long the previous unit lasted in a maintenance log, if it was captured. Bringing these together at the moment a replacement is due could make the decision faster and easier to justify. This demo explores that idea.

## Who it's for

The site's operations or facilities engineer: the person who has to notice a part is due, get it ordered from the right supplier, and make sure the swap is done safely.

## How it fits Entangl

Entangl's site lists two features as not yet live:

- **Maintenance planning** (*planned*): "Plan preventive schedules around asset requirements, service intervals, and the work your site needs."
- **Service procurement** (*planned concept*): "compare invited bids against one scope, then keep the decision connected to the delivery record."

This prototype is my take on both, applied to spare parts, and it links back to the product Entangl sells today, procedure generation and review. It is built from their public site only; it makes no claim about their internal plans.

---

## Walkthrough

1. **Site.** A static isometric drawing of the facility. Each machine is tagged and coloured by its most urgent part. Clicking a machine opens a popup with its parts.
2. **Equipment.** Parts that need attention (failed, or due by the rules below) are pinned at the top. Below, every machine opens to show its parts, service life, end of life and purchase options.
3. **Suppliers.** Quotes for one part, ranked by a recommendation engine (below). Each row shows what's included, delivery date against end of life, price against the last purchase, and the previous supplier.
4. **Buy on the supplier's site, record it here.** "Go to supplier" opens the supplier's page (a placeholder in the demo). "Mark as ordered" records the PO and delivery date. "Already purchased" records a part bought outside these quotes.
5. **Replacement procedure.** Every request links to a draft method of procedure (MOP) built from the part, machine, site documents and order, with the steps that need an engineer's input flagged.
6. **Orders & activity.** Every order and every action, with who did it and when.

"Destroy" in a machine's popup makes a part fail on demand, so the failure path can be shown. "Reset demo data" restores everything.

---

## Product decisions and trade-offs

**Link out to buy rather than build a checkout.** Sites buy critical spares through their own purchasing systems, with POs and approvals. A checkout inside this tool would be the least realistic part of it. But a bare link would lose what makes the tool useful: knowing an order happened. So buying happens on the supplier's site, and recording it here is one short form. That record is what clears the part from *Needs attention*, updates the last price and previous supplier, and feeds the activity log.

**Rules, not predictions.** A part is *due* when any of these is true:

- it is within 90 days of its rated end of life;
- ordering today from the previous supplier would arrive within 30 days of its rated end of life;
- ordering today from the previous supplier would arrive within 30 days of the age the last unit failed at ("Due · approaching previous service life").

The delivery-based triggers mean a slow supplier makes a part due sooner, so there is still time to order before it matters. The history-based trigger only ever makes a part due, and the reason is always shown. Nothing claims to diagnose or predict a failure, in line with how Entangl describes its own tools.

**Status is computed on the server.** End of life, the reason a part is due, and whether a recorded order resolves it are derived in one place, so the Site drawing, Equipment list, popups and Suppliers page always agree. A part only counts as resolved by an order placed inside its current warning window, so an old order never hides a new problem.

**How suppliers are ranked.** The engine ([server/recommend.js](server/recommend.js)) scores delivery, exact part match and price, weighted by how urgent the part is:

| Situation | Delivery | Exact match | Price |
|---|---|---|---|
| Failed or past end of life | 60% | 20% | 20% |
| Due | 30% | 40% | 30% |
| Planned | 10% | 45% | 45% |

- For a failed part, the fastest delivery wins.
- Otherwise, any delivery that lands before end of life scores the same. It only counts against a quote when it arrives far closer to end of life than the best alternative: more than a year closer, or with a tenth or less of that quote's margin.
- An exact OEM part beats a compatible alternative. The part's previous supplier always counts as an exact match, since it supplied that part before.
- So between exact parts that all arrive on time, the cheapest wins.

The ranking only decides the order of the list. I kept the scores off the page because they cluttered the comparison, but every ranked quote carries its factor scores and plain-language reasons in the API, ready to show if engineers want them.
*The engine is very simple for the purpose of the demo

**The procedure link.** Ordering a part is half the job; replacing it safely is the other half. The draft MOP ([server/procedure.js](server/procedure.js)) reflects the order (who installs, who disposes of the old parts, when delivery is due) and refuses to make up values such as torque settings. That gap is where Entangl's procedure generation and review would take over.

---

## Architecture

```
public/            Frontend: plain HTML, CSS and JavaScript, no build step
  index.html
  app.js           Views, state and API calls
  site.js          Static isometric site drawing, rendered as one SVG
  style.css        Colour tokens for light and dark mode
server/
  index.js         Starts the server
  app.js           Express API: routes, validation, transactions
  db.js            SQLite schema and seed data
  recommend.js     Supplier recommendation engine
  procedure.js     Draft replacement procedure builder
test/
  api.test.js      API behaviour, end to end against an in-memory database
  recommend.test.js  Recommendation engine rules
```

- **Runtime:** Node.js 22.13+ with Express 5.
- **Database:** SQLite through Node's built-in `node:sqlite`, so there is nothing native to compile. Stored at `data/ntgl.db` and created with seed data on first run.
- **Tests:** Node's built-in test runner. 34 tests.

### Data model

| Table | Holds |
|---|---|
| `equipment` | Machines on site (UPS-A, BS-A1, CRAH-3, GEN-1) |
| `parts` | Parts inside each machine: quantity, install date, rated service life, spares on hand, how long the previous unit lasted, failure time |
| `supplier_requests` | One request per replacement: `open` → `ordered`, `purchased` or `cancelled` |
| `quotes` | Supplier quotes for a request: lead time, unit price, exact or alternative part |
| `orders` | Recorded orders, whether from a quote or bought elsewhere |
| `purchase_history` | Every purchase of a part, used for last price and previous supplier |
| `audit_log` | Every action: who, what, when |

### API

| Method | Path | Does |
|---|---|---|
| GET | `/api/equipment` | Machines with their parts and most urgent status |
| GET | `/api/parts` | Parts with computed status, Due reason and open request |
| POST | `/api/parts/:id/requests` | Start a request and generate supplier quotes |
| GET | `/api/requests/:id` | Request with ranked quotes, last purchase and order |
| GET | `/api/requests/:id/procedure` | Draft replacement procedure |
| POST | `/api/requests/:id/orders` | Record an order placed with a supplier |
| POST | `/api/requests/:id/already-purchased` | Record a part bought elsewhere |
| POST | `/api/requests/:id/cancel` | Cancel an open request |
| GET | `/api/orders` | All recorded orders |
| GET | `/api/audit` | Activity log |
| POST | `/api/parts/:id/destroy` | Demo only: make a part fail |
| POST | `/api/demo/reset` | Demo only: restore seed data |

Every change except the demo reset needs an `actor` (the name in "Acting as") and is written to the audit log in the same transaction.

---

## Running it

Requires Node.js 22.13 or later.

```bash
npm install
npm start
```

Then open http://localhost:8765. Set `PORT` to use another port.

```bash
npm test
```

---

## Limitations and what I'd do next

- **Frontend.** Plain JavaScript keeps the prototype small and easy to read. For production I'd move to React and TypeScript, with component and end-to-end tests.
- **Identity.** "Acting as" is a free-text name. A real version needs sign-in, roles, and approval before an order is recorded.
- **Suppliers.** Quotes are simulated and the supplier links are placeholders. Next would be a request-for-quote flow sent to invited suppliers, closer to Entangl's service procurement concept, with bids for the work (supply and install) rather than only parts.
- **Installation.** The prototype stops at ordering. Recording when a replacement is installed would reset a part's life and capture how long the old unit actually lasted, which would make the previous-lifespan rule self-updating.
- **Tuning the engine.** The weights and thresholds are my judgment. I'd want to check them with site engineers and make them configurable per site.
- **Procedures.** The MOP outline is a template. The real version is Entangl's procedure generation and review.
