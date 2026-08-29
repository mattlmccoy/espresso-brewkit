# espresso·brewkit

**Measurement tools for espresso.** A browser-based toolkit for pulling a shot with
a Bluetooth scale streaming into the log, propagating measurement uncertainty, and
working out which variables actually move extraction yield — plus the design for an
open-source scale that records all of it without a phone.

**→ [Open the tools](https://mattlmccoy.github.io/espresso-brewkit/)**

Nothing installs, nothing uploads, and there is no account. The tools run entirely
in your browser; your shots live in your browser's local storage and export as a
plain CSV you own.

---

## The tools

| | |
|---|---|
| **[Live](https://mattlmccoy.github.io/espresso-brewkit/live.html)** | The session, driven by the scale. Weigh, grind, pull, rate — it steps itself. |
| **[Shots](https://mattlmccoy.github.io/espresso-brewkit/shots.html)** | Every shot you have pulled, with its flow curve, its diagnosis, and how it sits against the rest. |
| **[Advisor](https://mattlmccoy.github.io/espresso-brewkit/advisor.html)** | Which way to move the grind — one model inverts the flow physics, another searches your own ratings. |
| **[Kit](https://mattlmccoy.github.io/espresso-brewkit/kit.html)** | Bags, grinders, machines and consumables. What a shot was made with, how stale it was, and what is running out. |
| **[Lab](https://mattlmccoy.github.io/espresso-brewkit/lab.html)** | The analysis half: refractometry, regression, outlier detection, uncertainty propagation. |

Pulling a shot and analysing one are different activities on different schedules.
The first happens with a wet hand while coffee is going cold; the second happens
afterwards, needs a refractometer for its most interesting output, and rewards
sitting down. Putting all of it in one flat navigation bar made eight things look
equally routine when four of them are occasional — hence **Lab**.

## The session steps itself

The Live page is **Dose → Grind → Brew → Rate**, and the scale drives it. You weigh
beans, grind into the portafilter, lock in and pull; the only thing you touch is the
rating at the end. It produces a single row with 35 fields in it, including the flow
curve, and every other tool reads that row.

What makes this readable is not clever event detection. A scale-side tare and a
lifted vessel both just drop the reported number, and **nothing in the stream tells
them apart**. What separates them is that a vessel is not dose-sized:

```
dosing cup on      52 g    too heavy to be a dose  → ignored
press tare          0 g    a drop, but nothing was a candidate → ignored
beans in         18.2 g    plausible               → candidate
lift cup off      -52 g    a drop, with a candidate → COMMIT 18.2 g
portafilter on    469 g    too heavy               → ignored
press tare          0 g    ignored
grind into it    17.9 g    plausible               → candidate
carry to machine -521 g    → COMMIT 17.9 g
```

So: remember the last settled reading that could plausibly be coffee, and commit it
when the weight falls away. A drop with **no** candidate behind it is a tare or a
vessel being swapped, and it means nothing — which is exactly why the machine has to
sit still through it rather than advance.

Dose into an untared cup and brewkit only ever sees cup-plus-beans, which is not
dose-sized, so nothing is captured. It says so rather than recording the cup as
coffee.

Every captured value is displayed and stays editable, and every step is still
reachable by hand. The earlier auto-tare bug was not caused by automation; it was
caused by automation you could not see.

- **Dose and grounds-out are weighed, not assumed.** The difference is retention —
  the grounds still inside the grinder — which is why a single-dose workflow rarely
  gives back what you put in.
- **The curve is kept.** First-drip time, peak flow, steady flow and the late-shot
  flow slope are computed at full rate, then the curve is stored downsampled to 4 Hz
  (`t:w|t:w|…`, about 1.4 kB) so a CSV of shots still opens in a spreadsheet.
- **Idle means idle.** Weighing beans, taring, swapping a dosing cup for a
  portafilter — none of that is a shot, and the state machine does not react to
  any of it. Only arming starts vessel detection. Your scale's own tare button
  works too: when the reading jumps to zero brewkit follows it rather than
  stacking its own offset on top and showing a large negative number.

## Kit is a set of real objects

Bags, grinders and machines are entities, not free text typed onto each shot.
The shot stores an id; the name is copied alongside it so the exported CSV still
means something months later on a computer with no local storage.

A machine carries the settings it usually runs at — temperature, pressure,
pre-infusion, basket — and those become a shot's defaults, so they stop being
four fields retyped every time. Anything set on the shot itself still wins.
Machine *type* is recorded too, and is not decoration: a lever's pressure is
whatever the spring or your arm is doing at that instant, which means something
quite different from a pump machine's gauge reading.

## Running it locally

The site has no build step, so this is a static server and nothing else:

```sh
git clone https://github.com/mattlmccoy/espresso-brewkit
cd espresso-brewkit
npm start          # http://localhost:4173/live.html
```

The port is fixed on purpose: a Google OAuth client id only works from origins
registered against it, so add `http://localhost:4173` under *Authorised
JavaScript origins* once and sign-in works locally too. Everything that is not
sign-in works without it.

**Web Bluetooth needs a secure context, and `http://localhost` counts as one**,
so the scale connects over plain HTTP on the machine running the server. A phone
reaching that server by LAN address does not: `http://192.168.x.x` is not a
secure context and Safari will refuse to open a peer connection there. So run
the laptop locally and open the published `https://` copy of `view.html` on the
phone — the two halves of the link only exchange codes, and do not need to share
an origin. `npm run start:lan` binds to the network and prints the addresses, for
everything except that.

`npm test` runs the whole suite in headless Chromium; `npm run check` is the
syntax pass on its own, which is worth having because a shadowed identifier in a
test file otherwise costs a full browser run to discover.

## Watching a pour on a phone

No iOS browser has Web Bluetooth — not Safari, and not Chrome, which is Safari
underneath — so an iPad can never be the thing holding the scale. It can be the
thing watching, and until now the only way to get data onto it was Drive sync:
an account on both ends, and a pull-merge-push against Google's servers for a
number that changes ten times a second. That is the wrong shape twice over, and
a sign-in problem turns the whole viewer into a blank page.

[Watch](https://mattlmccoy.github.io/espresso-brewkit/view.html) takes the
frames straight off the laptop instead — **WebRTC, peer to peer**, no server, no
account, nothing hosted. The two devices are usually a metre apart on the same
Wi-Fi; the data has no reason to visit California first.

The awkward part is introductions. WebRTC peers cannot start without exchanging
a description of each other, and that is normally a signalling server's job.
There isn't one, so you do it: the laptop makes a code, the phone takes it and
makes a reply, the laptop takes the reply. Two copies and two pastes, once per
session, about fifteen seconds. On a Mac and an iPhone signed into the same
Apple account, Universal Clipboard means copying on one is pasting on the other.

**No ICE servers are configured**, which is a decision rather than an omission.
With none, the browser offers only host candidates — addresses on the local
network — so the link works on the same Wi-Fi and nowhere else. Across networks
it fails and says so, rather than quietly relaying your shots through someone
else's TURN server.

The channel is unordered and unreliable, and every frame carries the whole
current state rather than a delta: weight, flow, elapsed, brew state, session
step, dose, target, coffee, and the last 240 points of the curve. Losing a frame
therefore costs nothing, and a phone that joins mid-shot is not staring at a
blank chart.

## Two devices, no server

[Sync](https://mattlmccoy.github.io/espresso-brewkit/sync.html) keeps a computer
and a phone holding the same log, using **Google Drive's `appDataFolder`** — a
hidden per-app folder inside your own Drive, invisible in your file list and
readable only by this app. There is no backend, nothing hosted, and no account
here. The OAuth client id is public by design: a browser cannot keep a secret,
so Google secures it with an origin allowlist instead.

The client id ships with the site, so nobody has to make a Google Cloud project
to use a coffee log. It can, because it is public by construction: a browser
cannot keep a secret, so Google secures the id with an origin allowlist rather
than with secrecy, and one lifted from the page is useless anywhere but the
origin registered against it. It lives in `site/assets/js/config.js`, or in a
`<meta name="brewkit-client-id">` for anyone injecting it at build time. Setting
your own on the Sync page still works and overrides the shipped one — only the
override is stored, so clearing it returns to the default instead of breaking
sign-in, and a later deployment can move the default without stranding devices
that signed in under the old one.

Publishing the consent screen is what lets anyone sign in rather than a list of
named testers. Every scope here is **non-sensitive** — `drive.appdata` is the
narrowest Drive scope there is, and `openid email profile` only names the
account — so the app needs no verification *review* to go to production.

It still cannot be published from `github.io`. The branding page requires an app
home page and a privacy policy link, and the domains behind them must be listed
as **Authorized domains** — where `github.io` is refused, because it sits on the
[Public Suffix List](https://publicsuffix.org/) and Google treats it as a
registry suffix like `.com`. That is a property of the hosting, not of the app:
pointing a custom domain at the same GitHub Pages site clears it, and clears
Search Console verification with it. Until then the app stays in **Testing**,
where up to 100 accounts named on the tester list can sign in — which is the
right shape for a personal tool anyway, and costs nothing.

Setting that credential up is the one manual step for your own deployment, and
two of its fields cause
nearly all the trouble. **Authorised JavaScript origins**, on the OAuth client
id itself, is the one that matters: scheme and host, no path and no trailing
slash. **Authorised domains**, on the consent screen, is a different field and
will not take a `github.io` address at all — `github.io` is on the [Public
Suffix List](https://publicsuffix.org/), so Google treats it as a registry
suffix like `.com`, and no amount of site verification changes that. An
unpublished app has no use for the field anyway. What an unpublished app *does*
need is your own address under **Audience → Test users**; without it Google
answers *"Access blocked — has not completed the Google verification process"*,
and owning the project does not stand in for being listed on it. When a sign-in
fails the page names these causes itself, because Google's popup reports the
reason on its own page and then never returns to this origin — a blocked app and
a window you closed arrive here as the same event.

Signing in is Google's own flow: their account chooser, their consent screen,
their button. The page names each permission **before** you click, because a
consent screen is easier to approve honestly when you already know what it will
say. It asks for `drive.appdata` and, only so the page can show which account
you are syncing to, `openid email profile` — an account chooser that then tells
you nothing about which account you chose is worse than no chooser at all. Your
name and picture appear on the page afterwards and are never sent anywhere.

The access token is deliberately **not persisted**: it lasts about an hour, so a
return visit shows your account with "session expired" and a one-click
reconnect, rather than pretending to be signed in. Signing out revokes the token
with Google rather than merely forgetting it.

It **merges rather than overwrites**. Every sync pulls, merges and pushes. Shots
are unioned by id, so using both devices without syncing in between loses
nothing; where the same shot was edited in both places the later edit wins.
Deletions travel as **tombstones**, because a union can only ever add — without
them, deleting a shot on the laptop would pull it straight back from the phone.

The merge is pure and tested hard against a fake transport. The Drive half needs
a real Google account, so it is kept as thin as it can be — the less that lives
there, the less is taken on trust.

**On an iPhone or iPad it is a viewer and a logger.** No iOS browser has Web
Bluetooth — not Safari, and not Chrome, which is Safari underneath — so a phone
cannot stream the scale. It can read shots and curves, rate a shot, check what
is running low, and take weights by hand. Scale streaming stays on the computer.
That is Apple's decision, not something this project can work around.

## The flow, and how it reads the scale

Every weighing step is three phases, because that is how the job is actually
done: fetch a container, fill it, take it away.

| Phase | What it is waiting for | What it says |
|---|---|---|
| Vessel | something heavy to land | "Put your dosing cup on the scale" |
| Fill | the reading to reach your dose | "Tared. Dose your beans to 18.0 g" |
| Ready | you to take it off | "18.2 g — lift the dosing cup off" |

**It tares the vessel itself.** A cup that lands and holds still is tared in
software, so the display reads 0.0 g and the number you watch while dosing is
the coffee. The portafilter gets the same treatment on the next step. A tare
you press on the scale still works and is followed, because it is right there
under your thumb.

Two things stop that from misfiring. A vessel only counts once the platform has
been **seen empty** — otherwise the cup still standing there when the dose is
captured would be tared as the next step's portafilter, which is exactly the
auto-tare bug this project shipped once already. And because a 30 g cup and a
30 g dose weigh the same, a weight in that range is a container only if it
**arrived in one movement**: a cup is placed and is still within half a second,
a dose is poured and takes seconds to stop climbing. Above 45 g no argument is
needed, since no one pulls a 45 g shot.

**Reaching your target is what ends the step**, not a timer. Within about 12% of
the dose you are aiming for, the reading is captured and the screen says to lift
the vessel off — no countdown, because the app knows you are done and has said
so. Off-target, it cannot tell finished from paused, so the five-second hold and
the button are still there. Stillness for the vessel is judged from the raw
stream rather than from the flow estimator's idea of "settled", which is about
whether coffee is running and stays false for a second or two after any step.

## Bean age, with the freezer accounted for

Calendar days since roast is the number everyone quotes, and it is wrong for
anyone who freezes. Staling is chemistry — oxidation and volatile loss — and
chemistry slows when you make it cold. A bag roasted in January, frozen on day 5
and opened in June is **a five-day-old coffee that has been paused**, not a
five-month-old one, and recording it as five months would poison every model
that reads the column.

So age accrues before the freezer and after it, and barely during. The discount
is derived rather than picked: reaction rates fall roughly by half per 10 °C
(the Q10 rule of thumb), and a domestic freezer is some 38 °C below a kitchen —
3.8 halvings, about **1/14**, so ~0.07 days of staling per day frozen. A year in
the freezer costs about a fortnight of shelf life. Vacuum sealing halves it
again, because oxidation needs oxygen; that factor is a judgement and is
labelled as one. Freezing **slows** staling rather than stopping it, which is
what the literature actually supports.

### One way in, one way out

The model is a single freeze and a single thaw, and that is the protocol rather
than a simplification. Frozen beans sit well below the dew point, so opening a
portion condenses water straight onto them; refreezing seals that water in, and
the next thaw adds more. Staling is hydrolytic as well as oxidative, so a bag
that has been round the loop three times does not merely taste worse — it ages
faster, and its age stops being something a date can recover.

So the unit that goes in the freezer is the **portion**, not the bag. Kit will
split a purchase into portions: 900 g into six 145 g vacuum-sealed bags, frozen
the day it arrives, is six coffees each paused at day one, each opened exactly
once. Each portion is an ordinary bag with its own weight, its own thaw date and
its own shots, because from the grinder's point of view the portion *is* the
bag; what it shares with the parent is fixed at roast and simply copied. Once a
portion has been out, the app will not offer to put it back — there is no button
for a mistake, and `beanAge` carries one frozen interval, so a second freeze
could only be recorded by silently overwriting the first.

**The first shot off a portion is a different shot.** Only that one is actually
ground from frozen; the rest of the portion spends the session on the counter.
Cold beans fracture into a smaller mean particle size and a narrower
distribution ([Uman et al.,
2016](https://www.nature.com/articles/srep24483)) — a finer grind at an
unchanged dial, and so a slower shot. It is flagged on the row, badged in the
shot list, and held out of the resistance fit, because otherwise one shot in
eight drags the bag's intercept toward a grind that was never set. The
*direction* is settled; the *size* depends on your burrs and your freezer, so it
is measured from your own frozen shots against the fit they were excluded from,
and until there are three of them the app says the direction and admits it
cannot yet say more.

Age is reported as a phase rather than a bare number, because the same twelve
days is early for a light roast and squarely in the window for a dark one:

| Roast level | Rest before espresso |
|---|---|
| Light | 10–14 days |
| Medium-light | 8–12 |
| Medium | 7–10 |
| Medium-dark | 5–8 |
| Dark | 4–7 |

Roughly 40% of a bean's CO2 leaves in the first day and the rest over one to two
weeks. Espresso is the method that minds most, because pressurised water meeting
trapped gas is what channelling is made of — so a bag still degassing gets a
warning and an estimate of how many days are left, not a silent number. The
windows are roasting convention and vary with bean density and profile; the
mechanism is not.

Sources: [Uman et al., *Scientific Reports* 6:24483
(2016)](https://www.nature.com/articles/srep24483) — grinding cold narrows the
particle size distribution, which is both a reason to grind the first dose
straight from frozen and the reason that dose is excluded from the fit;
[SCA, *A Literature Review on Coffee
Staling*](https://sca.coffee/sca-news/2012/02/15/what-is-the-shelf-life-of-roasted-coffee-a-literature-review-on-coffee-staling);
[*Effect of Temperature and Storage on Coffee's Volatile Compound Profile*,
Foods 13(24):3995 (2024)](https://www.mdpi.com/2304-8158/13/24/3995); [Barista
Hustle, *A Year in the Deep
Freeze*](https://www.baristahustle.com/a-year-in-the-deep-freeze/).

## What is running out

Shots alone never account for a bag. Beans get purged through the grinder to
clear the last coffee, spilled, used for a pour-over, or thrown out when a bag
goes stale — so a log that only subtracts logged doses will always say you have
more left than you do, and **the error only grows**.

The balance is a ledger rather than a subtraction: shots deduct automatically,
and anything else you write down against the bag with a reason (purge, spill,
other brew method, gave some away, threw away, correction). A negative entry
corrects upward, which is what reconciling against what the bag actually weighs
looks like.

Remaining is reported in shots as well as grams, estimated from **your own recent
doses** rather than a nominal 18 g — pull triples and a nominal figure is wrong
by a third, and a wrong number there is worse than no number.

The same machinery covers everything else that depletes, because those differ
only in what they count: a **water filter** by shots pulled, **burrs** by kilos
ground, a **descale** by days elapsed. All of it appears on the Live dashboard
worst-first, so the thing about to bite is the thing you see while you are
standing at the machine.

## One screen

Live is a dashboard, not a document: three columns that fill the viewport once,
so pulling a shot never means scrolling with a portafilter in one hand. Each
column scrolls internally if its own content overflows, which is what stops a
long tag list pushing the weight off screen. Below 1100px it becomes a single
column and scrolls like anything else.

The fit is a test, not an intention: the suite asserts the page ends up **0px**
past the viewport, because the first three attempts were over by 349, 59 and
153px in ways that were not visible by eye.

What is on it, and why each thing earns its place:

| | |
|---|---|
| **Weight, time, flow** | the three you look at with a portafilter in one hand |
| **Lands at · to target · trend** | where the cup ends up if you cut now, seconds left, and which way flow is heading |
| **The pour** | weight *and* flow on one time axis, the target as a line, and a **ghost of a past shot** underneath |
| **This coffee** | days off roast, grams and shots left, average rating, and shot time over the last ten as a sparkline |
| **History strip** | the last eight pours as shapes — click one to make it the ghost |
| **Session** | the four steps with what each captured, and the pickers |
| **Supplies** | whatever is closest to running out |

Weight alone is the least informative thing a scale can draw: it only goes up,
and every shot looks like the same tilted line. Flow is where the shape is, and
the shape is what says whether the puck held. The **ghost** is the point of the
whole panel — pouring to match a curve you already liked is a far more direct
instruction than "aim for 28 seconds".

## Notes that stop explaining

A first-run explanation and a permanent fixture are different things, and this
had been treating them as the same. Three stacked paragraphs about browser
support are useful once and furniture thereafter, especially on a dashboard
whose whole promise is that it fits one screen.

Every recurring note carries a dismiss, and dismissal is permanent. There is one
control in the footer that brings them all back, because a preference you cannot
reverse is a trap rather than a preference.

## What you can watch while it pours

Six live numbers, none of which a scale's own display gives you:

| | |
|---|---|
| **Weight** and **Time** | tared and running, as you'd expect |
| **Flow** | estimated as a Kalman state, not differenced off the weight |
| **Lands at** | where the cup ends up if you cut *now*, including the drip that follows the pump |
| **To target** | seconds until you should cut, at the current flow |
| **Flow trend** | which way flow is heading, g/s² over the last few seconds |

That last one is the one worth having. An intact puck compacts as it runs, so
flow should be **sagging** by the middle of the shot. Flow that climbs is water
finding a path around the bed — and brewkit says so **while the shot is still
running**, about 0.5 s after the channel opens in testing, rather than in the
post-mortem. The trend is deliberately undefined until there is enough shot to
judge, so the opening ramp can never set it off.
- **The stop is predicted, not observed.** The puck keeps dripping after the pump
  cuts, so stopping when the cup reads the target overshoots it every time. The lag
  is learned from your own completed shots rather than assumed.
- **Nothing is required.** No scale, no bag, no rating — every step can be skipped
  or typed. A tool that insists on the full ceremony before it will time anything
  gets closed.

## What the curve tells you

Shot time and final weight cannot distinguish a channelled shot from a coarse one;
both are "22 seconds, 36 grams". The shape can. `diagnose.js` reads four scalars off
the curve and separates them:

| Signature | Reading |
|---|---|
| Flow **rises** through the back half | A channel opened. Grinding finer to fix the sourness makes the next one worse — it's a prep fault. |
| Flow falls steeply late | Fines migrating down and blocking the basket. Normal in small amounts. |
| First drop past ~12 s | Close to choking the machine; poor repeatability. |
| First drop under 3 s with fast flow | The bed is offering almost no resistance. |

An intact puck compacts as it runs, so its flow should **sag**. Flow that climbs is
water finding a path with less resistance than the bed around it, and that is the
one finding you cannot get from a stopwatch.

## Two models

**"What grind hits my target time?"** is physics. Flow through a packed bed is
Darcy's law, permeability goes as the square of particle size, and a grinder dial is
roughly linear in burr gap — so `log(flow)` comes out near-linear in dial setting.
Fit it, invert it, done. Usable after about three shots.

The grind sensitivity is **partially pooled**: it is mostly a property of the
grinder, not the bag, because the same dial step moves the burrs the same distance
whatever is in the hopper. So it is estimated across every shot on that grinder and
shrunk toward, rather than refit from the two shots a fresh bag has. The intercept
stays bag-specific, since how much a particular coffee resists is exactly what
changes between bags. The page says which half of the answer it borrowed.

**"What grind tastes best?"** is not physics — nobody has a model of your palate. So
it is a search: a Matérn 5/2 Gaussian process over your ratings, with expected
improvement picking the next setting to try, and a distance penalty so it does not
tell you to jump eight steps on the strength of six shots. It needs closer to ten
rated shots, and it says so instead of guessing.

Ratings are ordinal — the step from 6 to 7 is not necessarily the step from 8 to 9 —
and this treats them as continuous with a generous noise term. That approximation is
stated in the UI, because it is why the suggestion is a place to look rather than an
answer.

## Three things this does that a spreadsheet won't

**It tells you when not to believe the fit.** Every regression reports the slope's
95% confidence interval and says plainly whether it excludes zero. A trend line
through eight points with an interval spanning zero gets drawn — and labelled as
something not to act on. R² alone will not tell you that.

**It shows you which measurement is limiting you.** The uncertainty budget
decomposes the error in an extraction-yield figure into per-input contributions and
ranks them by share of variance. The usual result is that scale resolution
contributes essentially nothing while the Brix→TDS conversion factor dominates —
which means a better scale is not the upgrade, and buying one is money spent on the
wrong term.

**It doesn't trust the z-score.** A plain z-score is computed against a mean and
standard deviation that the outlier itself inflates, so at n=15 one extreme point
can push the threshold out past itself and vanish. Outliers are scored three ways,
including a median/MAD-based modified z-score that an outlier cannot drag.

## Live capture over Bluetooth

The Live page talks to a scale directly from the browser over Web Bluetooth —
no app, no phone, no server. It computes its own flow rate from the weight
stream with a constant-velocity Kalman filter (`site/assets/js/core/filter.js`),
because most scales report weight only, and differencing a smoothed weight signal
costs filter delay twice and amplifies the noise you just removed.

**Steps are detected, not filtered.** A constant-velocity model is a good
description of espresso and a terrible one of putting 18 g of beans on a scale: a
step has no velocity, so the filter can only explain a jump as an enormous one, and
it slingshots past. The plain version overshot an 18 g step to 25 g and took 1.7 s
to settle. Now a single large innovation is still damped as a droplet impact or a
knock, but several in a row all in the same direction are taken as the world having
genuinely changed — believe the scale, zero the flow, carry on. That settles in one
sample with no overshoot, and it frees the process noise to be tuned for flow
smoothness alone rather than for chasing steps.

**A saved scale is one click.** `requestDevice()` always shows the browser's
chooser — that *is* the permission prompt, so there is no way around it the first
time. But `navigator.bluetooth.getDevices()` returns devices the origin already
holds a persisted permission for, and connecting to one of those needs no chooser
at all. Saved scales are buttons: click yours and it connects. Where the browser
has no `getDevices()`, clicking still opens the chooser — filtered to that one
device rather than everything in the room — and the page says which of the two is
about to happen instead of promising one click and delivering the other.

**Browser support is the real constraint.** Chrome, Edge and Opera have Web
Bluetooth; Firefox and Safari do not, and on iOS no browser does. It also needs a
secure context, which GitHub Pages provides but a plain-http LAN address does not.

**Undocumented scales.** Most cheap BLE scales send an unlabelled fixed-layout
frame, and there are only a few hundred plausible encodings. Rather than needing a
datasheet, the Live page searches: put known masses on, tell it what the scale
reads, and it solves for offset, width, byte order, sign and scale factor, then
remembers the answer for that device. There is a byte-level frame view alongside it
for the cases that need a human.

**Supporting more scales, without guessing at protocols.** Shipping a driver
reverse-engineered from memory is worse than shipping none: a wrong scale factor
produces *plausible* numbers, which is the failure mode that is never caught by
eye. So breadth comes from two places that do not require inventing anything.

The first is the **standard [SIG Weight Scale profile](https://www.bluetooth.com/specifications/specs/weight-scale-service-1-0/)**
(`0x181D` / `0x2A9D`) — a published spec, implemented exactly, so a scale that
speaks it works with no teaching step. Its flags byte carries a metric/imperial
bit, so the scale factor is a property of the frame rather than of the device; a
driver that assumed one would be wrong by a factor of 2.2 on a scale set to the
other. Worth knowing before you rely on it: **the profile's resolution is 0.005 kg
— 5 g steps.** That is fine for a bathroom scale and useless for dosing espresso,
and the page says so rather than presenting a confident-looking 18 g.

The second is **shareable profiles**. Once a scale has been taught, Device
settings exports a small JSON file describing how it encodes weight; anyone with
the same model imports it and skips the teaching step entirely. A scale is then
worked out once by somebody rather than once by everybody, and adding support is
a file rather than a code change. Imported decoders run against live frames, so
every field is validated on the way in rather than trusted — and a profile whose
characteristic the connected scale does not notify on is refused as being for a
different model.

**A limitation worth knowing before you start.** Web Bluetooth will not enumerate a
GATT service the page did not declare in advance — there is no "list everything"
call. `transport.js` asks for a list of service UUIDs that cheap scales commonly
use, but a scale outside that list will appear to have no services at all. That is
the API behaving as designed, not a broken device.

The same driver interface is what the [scale in `design/`](design/03-wireless.md)
will connect through, so building this is not throwaway work.

## Repository layout

```
site/       the GitHub Pages app — plain HTML + ES modules, no build step
  assets/js/core/    stats, uncertainty, coffee math, CSV, storage, charts, filters,
                     bags and grinders, curve diagnosis, the two advisor models
  assets/js/ble/     Web Bluetooth transport, protocol auto-decoder, mock scale
data/       shots.csv (canonical dataset) + the original per-shot files
design/     specification for the scale hardware and firmware
test/       Playwright UI suite and its static server
```

### `site/`

Static. No bundler, no framework, and nothing to build — the site has no runtime
dependencies at all. ES modules need HTTP, so `file://` won't work; serve it:

```bash
npm run serve                 # prints a local URL, serves site/ with data/ mounted
```

## Tests

`npm test` drives the site in a real browser and asserts on what actually renders.
274 assertions across the site in both themes: the analysis results, the
legacy CSV import path, the 3D drag interaction, theme persistence, font loading,
WCAG contrast on chrome pairs, grid alignment, horizontal overflow, chart sizing,
and the absence of rhetorical-question headings.

The models are tested against ground truth rather than against themselves. The
resistance fit is given shots generated from a known `log(Q) = a + b·grind + c·days`
and has to recover `b` and `c`; the recommendation has to match the closed-form
inverse; the curve metrics have to recover a flow profile whose peak, steady rate
and late slope are known by construction; and the filter has to survive a step, a
droplet impact, a slow pour and a whole shot. Refusals are tested too — the advisor
must decline to fit two shots, or eight shots all at the same setting, rather than
emitting a confident number.

```bash
npm install
npx playwright install chromium
npm test
```

Playwright is the only dependency and it is dev-only — nothing ships to the browser.
The suite runs on every pull request via `.github/workflows/test.yml`.

It exists because it keeps finding real defects that reading the source did not: a
grid adjacency margin staircasing a row of controls, a `min-width:auto` track forcing
29px of horizontal page overflow, an illegible colour pairing that only appears in
dark mode, and a chart size cap applying to the wrong charts.

Charts are hand-rolled SVG rather than a charting library. Three reasons: the chart
types here are few and specific, colours come from CSS custom properties so
everything follows the light/dark theme and the design language for free, and the
3D view needs a fitted regression plane rather than a generic surface. Markup, CSS
and JS come to roughly 55 kB across the whole site, against ~3 MB for Plotly.

Fonts (Archivo, Archivo Black, Space Mono) are self-hosted from `site/assets/fonts/`
— latin subsets only, ~160 kB, cached after the first page. Self-hosted rather than
linked from Google Fonts so there is no third-party request, no render-blocking
dependency on a host outside the project, and the pages render identically offline.

### Design language

Hard edges and offset shadows, no border radius anywhere, Archivo Black for display
type, Space Mono for every number. One accent for chrome and data points, one for the
fitted line, one for anything flagged — so no colour has to mean two things at once.
Both themes are defined in `site/assets/css/app.css` as custom properties; the chart
module reads those properties and knows nothing about the palette, which is why
restyling the site does not touch the maths.

Page headings state the tool's name. No rhetorical questions, no taglines.

### `design/`

The scale is a design, not a build — see [`design/`](design/) for the full
specification and [`design/06-roadmap.md`](design/06-roadmap.md) for the plan.
Short version of the interesting decisions:

- **NAU7802 over the usual HX711.** 320 SPS rather than 80 leaves room to
  oversample and to build an anti-alias filter that rejects vibration pump noise
  at 50/60 Hz. At 80 SPS that noise aliases into the passband, where it is
  unrecoverable by any downstream filter.
- **Flow rate as a Kalman state, not a derivative.** A constant-velocity filter
  carries `[weight, flow]` jointly, so flow comes out as an estimate rather than
  `Δw/Δt` on a smoothed signal — no derivative noise amplification, no second
  helping of filter delay.
- **ESP-NOW for the detachable display.** ~2 ms round trip against BLE's realistic
  15–30 ms, which is the difference between a readout that feels attached to the
  scale and one that feels like a laggy remote.
- **~$52 in parts.** The $200 scales use the same load cells.

## Migrating from the Python version

This repository previously held a 1,059-line interactive CLI (`espresso_extraction.py`)
that wrote one CSV per shot. That is gone; the git history has it if you want it.
Everything it did is now in the web tools, and a few things it did wrong are fixed:

| Then | Now |
|---|---|
| One CSV per shot, headers repeated in each | One table, `data/shots.csv` |
| TDS stored as a fraction but labelled TDS | Stored as a percentage, consistently |
| Brix factor treated as an exact constant | Treated as a measured value with its own uncertainty |
| R² and RMSE only | Slope confidence intervals, significance, residual plots, adjusted R² |
| Z-score outliers | Z-score, IQR, and modified z-score side by side |
| matplotlib windows and saved PNGs | Interactive SVG, themed, in the page |

Your old files still work — drop any of the original `extraction_N.csv` files onto
the [shot log](https://mattlmccoy.github.io/espresso-brewkit/logger.html) and they
convert on import. The 15 original extractions are preserved in
[`data/legacy/`](data/legacy/) and ship as the sample dataset.

### About the Brix factor

The largest correctness change is that the Brix→TDS factor is no longer treated as
exact. A refractometer measures refractive index and reports it on a sucrose scale;
coffee solubles are not sucrose, so a correction is applied. 0.85 is the common
convention, but the true value depends on roast level, reference method, and
instrument, and published values span roughly 0.79–0.89. Propagating only the Brix
and mass uncertainties — as the original did — understates the result. Set `u(k)`
to 0 in the [uncertainty tool](https://mattlmccoy.github.io/espresso-brewkit/uncertainty.html)
to reproduce the old numbers and see the difference.

## Deploying

`site/google5caa7feb8604ab88.html` is a Google Search Console verification file.
It is a single line of text that must be served byte for byte at its exact path,
which is why the deploy's sanity check tests for a closing `</html>` only in
files that have an opening one — a verification stub is not a truncated page,
and treating it as one would fail the deploy of the whole site.

`.github/workflows/pages.yml` builds and deploys `site/` on every push to `main`.
It needs **Settings → Pages → Source: GitHub Actions** enabled once.

## Video

The original project walkthrough, from the Python era:
<https://www.youtube.com/watch?v=FDcUICSV3XE>

## License

MIT — see [LICENSE](LICENSE).
