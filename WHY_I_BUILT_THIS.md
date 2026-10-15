# Why I built a spares demo for Entangl

*Oct 15, 2026 · @Ryota*

This summer I worked as a product manager and prototype engineer intern at Indeed. I wanted to find out whether what I learned there is something I can actually use, so I tried it on Entangl. I looked at what Entangl does today, where its site says it is going, and where its clients are likely to feel pain, and came up with a product idea that I think fits. Then I built it.

*This is an unofficial concept built from Entangl's public site only. It makes no claim about their internal plans, and every site, part, supplier and price in it is fictional.*

> **Demo:** 

## The idea

Data centers are full of parts that wear out: battery jars, fan kits, filters. When one is due, the information needed to replace it can sit in several places: the rated life in a datasheet, the last supplier and price in an inbox or purchasing system, and how long the previous unit lasted in a maintenance log, if it was captured. My demo brings that together. It shows which parts are due, compares suppliers for the replacement, records the order, and links it to a draft procedure for doing the replacement.

It builds toward two things Entangl's site lists as planned, maintenance planning and service procurement, and hands off to what Entangl already does: procedures written against the site's own records.

Before building, I tested the idea against three questions:

- **Would it make clients' work easier?** It puts what is due, who supplied it last, what it cost and how long the last unit lasted in one place, instead of three.
- **Would it benefit Entangl?** Every replacement needs a safe procedure, so it feeds the product Entangl sells today and gives its planned features a concrete first use case.
- **Would it scale Entangl's product?** I think it could add a parts layer to it, explained below.

Entangl's site already points this way. Its overview lists inventory and critical spares among the things to coordinate when running a facility, and its planned maintenance workflow treats required parts and vendor readiness as prerequisites before a job can go ahead. What I couldn't find is a workflow for the step behind that check: noticing when a part is due, choosing a supplier and recording the order, with how long the last unit lasted feeding the next decision, much like the page's idea of using completed work to review future intervals. That is what my demo explores. It doesn't cover scheduling work windows, and at a real site some of this data would probably live in existing maintenance or purchasing systems, a question the page also leaves open. I see it as one way the parts side of that plan could work, not a claim about how Entangl is designing it.

It also fits where Entangl says the value is. Its site talks about letting engineers spend their attention on judgement, exceptions and approval, and it cites Uptime Institute research that 46% of surveyed operators struggle to find qualified candidates. Noticing that a part is due, comparing suppliers and chasing records is routine coordination that a tool can carry, so fewer people need to spend time on it. I don't read Entangl as trying to take people out of the loop, since its site keeps approvals with authorized engineers, so the demo never places an order by itself. It prepares the decision and records it. If Entangl's direction is toward facilities that need less manual coordination, this points the same way, with the engineer still deciding.

Across many sites, the due rules are computed from data rather than hard-coded per machine, so a new site means new records. What would not scale yet is real supplier integration: quotes are simulated and the supplier links are placeholders, so each real supplier would need its own connection or request-for-quote flow. The README's limitations section lists the rest.

## Decisions

The demo doesn't try to be a shop. Each supplier has a link to buy on their own site and a way to record the order here, and there is an option to say the part was obtained elsewhere. That turns it into a tracker for every replacement, however the part was bought, and keeps it within what Entangl does and where it is heading rather than becoming a purchasing system.

I also kept using it the way a site engineer would and fixed what didn't make sense: a supplier labelled a "compatible alternative" when it had supplied that exact part last time, or delivery speed counting against a supplier whose parts would arrive well before they were needed.

## How I built it

I decided what to build and why. I used AI (Claude) to build the base of each piece, for example connecting the supplier list to a ranking engine and displaying the ranking. Then I reshaped it, change by change, until it did what I intended: what the engine ranks on, how the result is shown, and when a part counts as due. Every rule in it is one I chose and can explain. The weights are my own judgment, and I would want to check them with site engineers.

The code, a README of the product decisions and a step-by-step development log are in this repository (see `README.md` and `docs/DEVELOPMENT.md`).

## How I'd work at Entangl

My background is in Electronic and Information Engineering (EIE). My microgrid project at Imperial spans hardware, firmware, a backend and a front end. I built the demand-side control firmware and the team's whole front end, so I'm comfortable working across the layers between software and physical equipment.

At Indeed I visited clients, asked how they used the product and where it hurt, and showed them prototypes. Jimmy described the full-stack role at Entangl as working directly with clients, and that is how I'd want to work here: close to the people using the product, building for their problems and Entangl's direction rather than my own idea. This demo changed many times whenever something didn't hold up, and I'd expect your team and your clients to change it further.

I also put in the effort a project needs when it gets hard. In my first-year project, our team of six built a remote-controlled rover that decoded ultrasonic, infrared, radio and magnetic signals. Three of the six members were unavailable. I designed two of the four decoding circuits and wrote all of the software: the web control interface and the connections between it and the hardware. When the decoders failed intermittently because they couldn't draw enough power, I added batteries and accepted the extra weight to make them reliable. Our team placed first in the department, out of about 200 students.
