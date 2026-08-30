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
| **[Advisor](https://mattlmccoy.github.io/espresso-brewkit/advisor.html)** | Which way to move the grind — one model inverts the flow physics, another searches your own ratings. It says *finer* and *coarser*, not *up* and *down*: the sign of the fitted grind coefficient tells it which way your dial actually runs, measured on your shots rather than assumed about grinders in general. When that coefficient is smaller than its own uncertainty it says so and falls back to dial steps. |
| **[Kit](https://mattlmccoy.github.io/espresso-brewkit/kit.html)** | Bags, grinders, machines and consumables. What a shot was made with, how stale it was, and what is running out. A grinder also records how it is fed, which decides whether the coffee is a property of the hopper or a choice made every shot. |
| **[Lab](https://mattlmccoy.github.io/espresso-brewkit/lab.html)** | The analysis half: refractometry, regression, outlier detection, uncertainty propagation. |
| **[Backup](https://mattlmccoy.github.io/espresso-brewkit/backup.html)** | The whole log to a file, and back again. Restoring merges rather than overwrites. |

Pulling a shot and analysing one are different activities on different schedules.
The first happens with a wet hand while coffee is going cold; the second happens
afterwards, needs a refractometer for its most interesting output, and rewards
sitting down. Putting all of it in one flat navigation bar made eight things look
equally routine when four of them are occasional — hence **Lab**.

## The walkthrough on the home page

The front page plays the whole session — pair, dose, grind, brew, read — before
you have connected anything. It loops, it has chapters you can jump between, and
it pauses when it scrolls out of view.

It is drawn rather than recorded. A screen recording would have been far less
code and worse in four ways: a file to host, wrong the first time the interface
changed, unreadable at a phone's width, and frozen in whichever theme the
recording was made in. This runs in the current palette at whatever size the
grid gives it, and the brew chapter draws its curve through `livePlot` — the
same function the Live page uses — so the picture cannot drift away from the
product.

`core/tour.js` holds the timing and the physics and touches no DOM, which is the
half worth testing. The fake shot is generated from a flow function rather than
keyframed: nothing during pre-infusion, a rise as the puck wets through, and a
sag at the end as it erodes. Integrated, that lands on 36 g in 27.5 s with a
2.1 g/s peak. The suite asserts all of it, because the first thing anyone sees
from a tool that claims to read curves should not be a curve no espresso ever
made.

`Tour.tick()` takes a delta rather than reading a clock. That is what lets the
suite step it exactly, and it is also why a tab returning from the background
cannot skip the story: the delta is capped at 120 ms, so one enormous frame
advances one beat instead of forty.

Reduced motion does not get a still image. It gets the same five chapters, each
opening on its finished frame, driven by the arrows — nothing is hidden behind
an animation that is never going to play.

## Motion, and what it is for

Four durations and three curves live as custom properties in `app.css`, so
nothing in the app invents its own timing. One media query at the top turns all
of it off for `prefers-reduced-motion`, which means every animation below is
written as though motion is on and none of them has to remember.

Motion here is meant to answer a question, not to decorate:

- **The tile, not the bar.** Landing in the dose window rings the whole hero
  tile. Across a kitchen the bar is a detail and the big blue rectangle is what
  you can actually see.
- **Stillness is the signal.** The fill bar crawls while you are under and stops
  dead when you are inside the window, so the bar answers "am I there yet"
  without being read.
- **One thing keeps moving.** "Stop now" is the only instruction on the page
  with a deadline, so it is the only thing allowed to keep sweeping until it is
  obeyed.
- **Arriving values announce themselves.** A step's captured weight and the two
  predictive tiles flash once when they change. The five readouts that stream at
  10 Hz do not — a flash ten times a second is not information.
- **Findings arrive in order.** The diagnosis is ranked most severe first and
  staggers in, because five things appearing at once is a wall rather than a
  list.

## The scale is also the button

Both hands are full, the portafilter is in one of them, and the laptop is two
metres away. The scale is already under your fingers and already streaming ten
times a second, which makes it the only control surface in the room you can
actually reach.

**The rule: nothing is bound while the scale is measuring.**

That is a correctness constraint, not a preference. A tap is a sixty-gram
excursion, and sixty grams arriving in one frame is not noise to a flow
estimator. Driven through the real filter, a two-tap gesture during a shot takes
the reported flow rate from **1.51 g/s to 167 g/s** — enough to trip the
predictive stop, corrupt the stored curve, and poison every model that later
reads it. The gesture would have destroyed the measurement it was part of. The
suite asserts that number, because it is the reason the table below has so many
blanks in it.

| Where | Double tap | Triple tap | Two taps, then hold |
|---|---|---|---|
| **Setup (00)** | start with this coffee | — | change brew method |
| **Dose / Grind / Milk**, waiting for a vessel | take back the last weight | tare | change brew method |
| **Dose / Grind / Milk**, filling | — | — | — |
| **Brew** | — | — | — |
| **Rate** | start the next shot | throw this shot away | change brew method |

The blanks are the design. The first version bound *capture* and *stop*, which
was spending the vocabulary on nothing: the app already captures when you lift
the vessel off and already stops on the predicted target. What is left over —
which coffee, that was wrong, start again, bin this one — is exactly the set of
things the scale cannot work out for itself, and all of it happens while the
platter is idle. The constraint and the useful vocabulary turned out to be the
same shape.

**Undo is the one that could not be automated.** Everything else the session
decides, it decides from the weight; "that was wrong" is information only the
person holding the portafilter has, and correcting it used to mean walking to
the laptop — the exact situation the hands-free flow exists to avoid.

### What a tap looks like, and what it does not

A tap is unmistakable in the raw stream: tens of grams for a couple of hundred
milliseconds, returning to exactly the level it started from. Nothing else a
scale sees does that — a cup steps up and *stays* up, coffee climbs at a couple
of grams a second, a drip lands and stays. The signature is not the size of the
excursion, it is the return. `core/tap.js` reads the **raw** stream on purpose:
the Kalman filter's whole job is to treat a 40 g spike lasting 150 ms as noise
and delete it, which is right for weighing and fatal for this.

Three things had to be got right, and each was a bug first:

- **A tap looked exactly like lifting the vessel off** — a rise and then a fall
  of the same size — so tapping the scale committed the step whatever the tap
  meant. A fall now has to *stay* fallen for a fifth of a second, measured
  against where the platter was resting 0.6 s ago rather than against the
  previous sample. A rolling average would have been wrong here: averages
  converge on the new level, so a real lift stops looking like a fall within a
  few frames. A fixed lag does not converge. This also rules out knocks.
- **A lone long press is indistinguishable from a scale-side tare** — both are
  "weight appears, then returns to baseline with nothing having moved" — and the
  first version fired the method switch during normal dosing. So the hold is a
  compound gesture. Nothing anyone does with a cup taps the platter twice first.
- **The first tap after a lift was being eaten.** The baseline only crept, so a
  second after a 70 g cup came off it was still somewhere near 10 and the tap
  returned to a level it did not recognise. It now *snaps* once the platter has
  been demonstrably still at a new level for a third of a second — which a tap
  can never be, being up and back inside 300 ms.

A single tap is never a command either. A scale on a counter beside a machine
gets knocked, and a one-tap vocabulary would fire the moment someone set a spoon
down.

## Step 00 is a step, not a formality

The coffee gets chosen every session, on purpose.

It used to advance itself. The selects are prefilled from the last session, so
"a coffee is chosen" was true the instant the page loaded, and setup was over
before anyone saw it. That is wrong in the one place it matters most: the bag is
the field most likely to have changed since yesterday — you finish one and open
another — and the one that quietly poisons the most, since roast age, the
per-bag model and what is left in the hopper all key off it. A remembered value
is a good proposal and a bad assumption.

So connecting a scale resets to step 00, `setReady()` records readiness without
moving, and `begin()` is the one deliberate act that starts a session. Next to
the button sits what confirming would actually confirm — *"Guji · 9 days —
coming into its window · 250 g left"* — because a yes/no on a name nobody read
is not a confirmation. Somebody about to start on *"41 days off roast, 12 g
left"* will notice.

The highlight follows what the flow is waiting on rather than sitting still: an
empty select while it is empty, then the start button, because once both are
chosen the thing between you and a shot is the confirmation.

### Except when the grinder already knows

Asking every time is right for a **single-dose** grinder and wrong for a
**hopper**, and the difference is not a matter of taste. A hopper holds one bag
until it runs out, so what is in it is a property of the grinder: you fill it
once and it stays filled across days and dozens of shots, and re-asking is
asking someone to retype a fact that has not changed. A single doser is fed a
weighed dose per shot, which is the entire reason people buy them — the coffee
can differ between consecutive shots, so assuming is how a log ends up filing a
Kenyan against a bag of decaf.

So a grinder now records **how it is fed**, and a hopper-fed one records what is
loaded in it. `supply.hopperAssumption()` decides whether step 00 can be taken
as read, and it says no more often than it says yes:

| | |
|---|---|
| Hopper, bag still has coffee | **assume** — skip the gate |
| Hopper, log says that bag is finished | ask — something else is in it now |
| Hopper, nothing loaded yet | ask — this session is what teaches it |
| Hopper, bag archived | ask |
| Single dose | ask, always |

Three properties make this safe to lean on:

- **It is never silent.** When the gate is skipped the page says which coffee it
  assumed and roughly how much is left, with a *Changed the hopper?* button
  beside it. An assumption you cannot see is an assumption you cannot correct.
- **It expires by itself.** The assumption dies the moment the log says the bag
  is empty, which is exactly the moment the answer has changed. No separate
  "I refilled it" ritual is needed for the common case.
- **Confirming is what loads it.** The hopper contents are recorded when someone
  actually confirms, never inferred from the remembered selection — otherwise
  the app would assume on the strength of its own guess, and the first session
  on a hopper it knew nothing about would skip the very question that teaches
  it. That was a real bug in the first cut of this.

Grinders default to **single dose**, because that is the answer that never
assumes, and a wrong assumption here does not announce itself: it quietly
corrupts roast age, the per-bag model, and what the supply page thinks is left.

## Espresso is not the only thing a scale can weigh

The session used to be espresso-shaped, with a portafilter hardcoded into the
middle of it. But the machinery underneath — tare when a vessel lands, aim a
weight at a target, plot weight against time — is not espresso machinery. It is
brewing machinery. A pour over is the same three phases with a different vessel
and a target ten times larger; a flat white is espresso with one more weighing
after it.

So `core/method.js` holds the step order, the vessel names, the targets, the
flow bands and the vocabulary as data, and the session machine reads them.

| | Espresso | Pour over | Milk drink |
|---|---|---|---|
| Steps | dose, grind, brew, rate | dose, brew, rate | dose, grind, brew, milk, rate |
| Brew weighs | yield **out** | water **in** | yield out |
| Default target | 18 g at 1:2 → 36 g | 22 g at 1:16 → 352 g | 18 g at 1:2, then 200 g milk |
| Flow band | 1.1–2.2 g/s | 3–7 g/s | 1.1–2.2 g/s |
| Curve diagnosis | yes | no | yes |

A pour over is exempt from the diagnosis on purpose: channelling, a fast puck
and a slow puck are espresso physics read off an espresso curve, and running
them over a pour would produce a confident wrong answer rather than no answer.

Switching method mid-session keeps whatever is already weighed — realising
halfway through that this is going to be a flat white does not un-weigh the
beans — and lands on the next step the new method shares with the old one.
That matters more than it sounds, because the switch is reachable from the
scale, and an accidental one must never cost a weighing.

## Flow, as a bar

The one thing every expensive scale draws that this only printed as digits.
"1.87 g/s" is a fact; a bar two thirds of the way along a marked band is an
answer, and across a kitchen only one of those works. The band is per method,
which is the whole reason it lives in `method.js` — a pour is poured an order of
magnitude faster than espresso flows, and espresso's scale would leave the bar
pinned at full for three minutes.

**And you say which one you are aiming at, at step 00.** The three styles were
already on screen during the pour as landmarks, which answers *what have I
made*. Picking one before the shot answers *what am I making* — and that is the
half the alert needs, because the target yield is what the countdown counts to
and what the chime chimes at. Without it the alert fired at whatever ratio
happened to be left in the field from the last session, which is the wrong
moment for the drink you actually wanted.

The aim *is* the ratio: choosing Ristretto writes 1.5 into the ratio field, and
everything downstream already reads that. So there is nothing else to wire and
nothing that can disagree with it. Each button carries the grams it means for
the dose you have set, so the choice is made in the unit the scale is about to
show. Espresso methods only — a pour over has ratios but not these names.

The laptop and the phone draw it from the same function, because the phone is
the one you are actually looking at and the two must not disagree about what
"too fast" means.

## Three drinks, one puck

A dose does not have one correct yield. Cut at 1:1.5 and it is a ristretto, at
1:2 an espresso, at 1:3 a lungo — same beans, same grind, same puck, three
different drinks, and which one you end up with is decided in the four seconds
while it is pouring. The app knew none of that. It knew one target, typed in
beforehand, and narrated the whole shot as distance from it.

So the pour now carries a **ladder**: the three classical marks in grams, ticked
onto a track at their real positions, and under each one how long until you
should cut for it. Your own target joins them as a fourth mark, or folds into
whichever one it is already sitting on. The lungo tick is usually somewhere you
have never been, which is the point — it is the option you did not know you had.

The grams are exact from the first drop, because they are a multiplication. The
seconds are not, and that is the interesting half.

### Why the countdown arrives late on purpose

Espresso flow ramps. There is pre-infusion, then the pump comes up, then the
puck saturates, and only after all of that does flow settle into something worth
dividing by. Both real shots in the log go from about 0.9 g/s at 2 s to a peak
near 2.4–2.9 g/s at 12–14 s. Divide the remaining grams by the flow you have at
4 s and you are dividing by less than half the flow you are about to get.

Replaying both curves through the real estimator and scoring every arrival
estimate against when the shot actually got there:

| projection made at | mean absolute error |
|---|---|
| 0–4 s | 14.50 s |
| 4–6 s | 7.49 s |
| 6–8 s | 3.24 s |
| 8–10 s | **1.00 s** |
| 10 s+ | **0.16 s** |

An estimate made in the first four seconds is wrong by more than the whole shot
is long. So for the first eight seconds the ladder shows the weights and the
word *settling*, and says nothing about time — which is a smaller failure than
saying something wrong, and the same refusal the advisor makes when asked to fit
two shots.

A correction for the flow trend was tried and thrown away. Fitting the decline
and solving the resulting quadratic was **worse** at every lead time — 1.33 s
mean error against 1.18 s — because the trend is a second derivative of a noisy
signal and the noise costs more than the curvature buys. The projection is
distance over flow, and the only thing it corrects for is the drip that keeps
coming after the pump stops, which is learned per machine.

Past about twelve seconds out the estimate is an extrapolation rather than a
countdown, and it says `~19 s` rather than `cut in 19.0 s`. Once a mark has been
close enough to count down it keeps counting down, so a shot whose lungo is
hovering on the boundary does not flicker between the two.

### What it is worth afterwards

The finished shot is stored with the style it turned out to be, not the one you
meant to make: aiming at 36 g and cutting at 27 is a ristretto and the log says
so. It is a column like any other, so it exports, imports and can eventually be
asked the obvious question — whether your ristrettos rate better than your
lungos — without anyone having to reinterpret a ratio by eye.

Crossing a mark also gets a short soft note, distinct from the countdown ticks
and the stop. It is information rather than an instruction: nothing needs doing
about passing ristretto, it only tells you where in the shot you are.

The phone draws the same ladder from the same module. Nothing about it goes over
the link except the machine's drip lag, because the phone already has the
method, the dose, the weight and the flow — sending the finished ladder ten
times a second would be sending arithmetic.

## Which way round the confidence goes

Reported from a real kitchen, and worth writing down because the code that
caused it read perfectly well:

> I will have 8 g of beans put on it and it will continue, but if I put 17.4, it
> just sits there and asks if I want to use it.

Both halves were true and both were the same line. A settled dose used to be
handled like this: if it is near the target, say so and wait, because a reading
on target has already told you what to do; otherwise run a five-second countdown
and take it, because the app cannot tell finished from paused. Defensible in
prose, and exactly inverted in practice. Against an 18 g target, 8 g is not near
it, so 8 g auto-advanced. 17.4 g is, so 17.4 g sat there. **The app was
confidently accepting the readings it had most reason to doubt.**

Confidence has to run the other way, so now it does. A settled plateau inside
the window is a finished dose and commits on a countdown you can watch and
interrupt. A settled plateau well outside it is either a dose in progress or a
mistake, and neither is something to advance past on a timer — it holds, says
which way it is out and by how much, and waits for you to lift the cup or press
the button. Only when there is no target at all does a bare timer decide
anything, because then it is the only thing there is.

Reaching in to take beans back out still cancels the countdown: a hand on the
platter reads as hundreds of grams, which is already understood as a
disturbance, and it restarts the plateau rather than capturing through it.

## Calibrating against readings rather than against reasoning

That bug survived being written down carefully, and it survived a test suite —
because the tests asserted the behaviour the prose described. Six of them had to
be rewritten when the polarity was fixed; they had been locking the bug in.

The deeper problem is that every threshold in the capture rules — how heavy is
too heavy to be a dose, how still counts as still, how long a plateau has to
last — was picked by reasoning about what a scale probably does. Nothing in the
repo had ever seen what this scale actually does.

So Live records the whole session and will hand it over: **Export this
session's readings**, under Manual controls. One row per sample at 10 Hz, with
the raw weight, the tared weight, the filtered weight and flow, the step, the
phase, the target, the pending candidate, the countdown, the disturbance flag
and the brew state — and, on the row that caused it, whatever the app decided
and which rule fired:

```
t_s,raw_g,net_g,filtered_g,flow_gs,settled,step,phase,...,event
12.4,70.2,18.2,18.19,0.01,true,dose,fill,...,
12.5,70.2,18.2,18.20,0.00,true,dose,fill,...,captured dose=18.2 g once the dose settled on target; advanced to grind
```

The thresholds in force are written into the header as comments, because a
column of weights explains nothing without the numbers it was being judged
against — and those are exactly what is under discussion. It is a ring buffer
holding about an hour, always on, and nothing leaves the machine until the
button is pressed. `core/trace.js` also parses the file back and summarises it,
so a session can be replayed against the rules offline rather than argued about.

## The gap between grinding and brewing

Ground coffee starts degassing and cooling the moment it leaves the burrs, and
picks up moisture from the air. Two otherwise identical shots pulled thirty
seconds and five minutes after grinding are not the same shot.

It costs nothing to record — both timestamps already exist, because the app
captures the grounds and starts the clock itself — and **nothing else logs it**,
because nothing else owns both ends of the gap. It goes on the shot as
`puck_prep_s`, it is a regression predictor like any other, and past four
minutes the diagnosis says so rather than leaving you to wonder why that shot
was unlike its neighbours.

## This shot against the one you actually liked

Every scale with an app will draw a reference curve behind the live one. Two
curves on one chart is a picture, not an answer: you still have to look at it,
work out where they part company, and remember what that meant.

`core/compare.js` does the looking. Both curves are resampled onto fractional
time and normalised by final yield, so a 32 s shot and a 26 s shot can be
compared as shapes rather than as clocks. Similarity is mean absolute deviation
rather than correlation — two curves that both rise monotonically correlate at
nearly 1 however differently they rise, which would call every espresso ever
pulled a match. Then it finds the largest gap and reports its sign:

> **66% like your 9/10 shot.** They part company around 9.1 s, where this one
> was 12% of the yield ahead: it was running faster than the shot you liked, so
> more of the cup arrived early.

"Best" is your own best on that coffee, not an ideal curve. There is no ideal
curve; there is the one you liked. And this can only exist because the ratings
and the curves are in the same rows — a scale that stores curves and a notebook
that stores ratings cannot be joined afterwards, which is why no scale app does
this.

## The drip lag belongs to the machine

After the pump stops, the puck keeps dripping, so cutting when the cup reads the
target overshoots it by that much every single time. The app has always learned
that lag from its own shots — the gap between the stop-press weight and the
final settled weight, divided by the flow at the time, is the lag in seconds,
measured rather than assumed.

What was wrong is that it was **one number for the whole app**. A lever and a
pump-driven machine with a bottomless basket do not drip alike, and a shared
estimate is wrong for all but one of them. It now lives on the machine's own Kit
record with a count of the shots behind it, so the page can say *"this machine
drips for about 1.40 s after the pump stops, from 5 shots"* rather than quietly
being confident. Below three shots it falls back rather than pretending, and an
impossible observation — a negative lag, or more than 3.5 s — is refused rather
than averaged in.

## The session steps itself

The Live page is **Setup → Dose → Grind → Brew → Rate**, and after setup the scale
drives it. You confirm the coffee, then weigh beans, grind into the portafilter,
lock in and pull; the only things you touch are that confirmation and the rating
at the end — or neither, if you use the scale itself for both. It produces a single row with 35 fields in it, including the flow
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
when the weight falls away — once the platform has *stayed* fallen for a fifth of a
second, so that a tap on the platter is not mistaken for a lift. A drop with **no** candidate behind it is a tare or a
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

The port is fixed on purpose, so the URL you bookmark keeps working and the
browser keeps the same storage bucket — your local log survives a restart of the
server rather than starting empty each time.

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

## What the log says about the habit

A shot log is a diary whether or not it was kept as one. Once there are a few
hundred rows the interesting question stops being "how was that shot" — and the
same rows answer the new one for free. Kit's **Habit** tab draws six months of
days as a calendar, because a table of dates cannot show a gap, a streak or a
Sunday habit, and a grid shows all three without being read. Beside it: the
current streak, the last thirty days, how many you pull on the days you pull
any, the kilo count, and the hour of day you actually reach for the machine.

Everything there is computed in local time. A shot at 07:30 belongs to the
morning it was pulled, and UTC would file half a year of them under the previous
day for anyone west of Greenwich.

## Leaving Live

A page navigation destroys a GATT connection and a WebRTC peer connection
alike — nothing in a web page can prevent that, and no worker can hold either
one on a page's behalf. So Live does two things instead.

**It does not need to reconnect by hand.** `navigator.bluetooth.getDevices()`
returns the scales this origin already has permission for, so a scale this tab
had open is picked back up on return with no chooser and no click. Only this
tab's own last scale, and only where the browser supports it — a page that
spontaneously starts talking to Bluetooth on load would be a worse bargain than
one click. An unexpected dropout keeps that memory, because that is exactly when
you want it back; pressing Disconnect clears it, because that was a decision.

**And while a scale or a phone is attached, the other pages open over this one
rather than replacing it.** A GATT connection belongs to the document that
opened it, and the phone's pairing is good for exactly one connection, so a
navigation costs both and only one of them comes back on its own.

This used to be handled by pushing the other pages into a new tab, which kept
the connection but left the shot on a window you were no longer watching. They
open in a frame over the top instead — the same overlay the phone has used since
it had the same problem for the same reason, now one shared component rather
than two copies. The page never navigates, so there is nothing to preserve; the
pour stays on screen in the bar with the connection's own status beside it; and
the store modules already listen for `storage`, which fires across same-origin
frames, so a bag edited in there updates the page underneath it. A link back to
the host page, followed inside the frame, closes the overlay instead of loading
a second copy that would go looking for the scale the first one is holding.

## Watching a pour on a phone

No iOS browser has Web Bluetooth — not Safari, and not Chrome, which is Safari
underneath — so an iPad can never be the thing holding the scale. It can be the
thing watching, and a file or a cloud round-trip is the wrong shape for a number
that changes ten times a second.

[Watch](https://mattlmccoy.github.io/espresso-brewkit/view.html) takes the
frames straight off the laptop instead — **WebRTC, peer to peer**, no server, no
account, nothing hosted. The two devices are usually a metre apart on the same
Wi-Fi; the data has no reason to visit California first.

The awkward part is introductions. WebRTC peers cannot start without exchanging
a description of each other, and that is normally a signalling server's job.
There isn't one, so the two devices have to hand the descriptions over
themselves. **The laptop shows a QR code and the phone points its camera at
it** — the code is a `view.html#p=...` URL, so the phone's own camera app opens
the viewer already holding the offer, answers it, and shows its reply as a
second QR for the laptop to read back.

Pasting still works and is still there, one `<details>` fold away, because a
camera can be pointed at the wrong thing and Universal Clipboard between a Mac
and an iPhone is genuinely quick. But it is the fallback now rather than the
route.

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

### The dial, the volume, and a screen that is not a large phone

The viewer started as one number and a curve, on the reasoning that a phone at
arm's length wants one thing made big. That is right for a phone and wrong for
an iPad, which has room for the number, the dial and the curve at once and was
showing a third of what it could.

So above 700 px the number and the dial sit side by side, the strip carries the
whole readout on one row — time, flow, target, dose, the ratio it is at right
now, where it lands if you cut when the drip stops, and how long until the
target — and the curve gets real height. A phone has the height for those seven
but not the width, so they go two abreast rather than being left off. The four
that mean nothing before a shot fold away rather than showing dashes over an
empty cup. Landscape on a phone gets the same
treatment in miniature. Below that it is the single column it always was, with
the dial added underneath the number.

**The dial has the drinks on it**, and a design review was blunt about the first
attempt: it read as a bad speedometer. The diagnosis was worth writing down,
because every fault was a thing that *looked* like information and was not.

- Two concentric arcs raced each other from a common origin — yield outside,
  flow inside — with no label, no scale and no number anywhere naming the
  second. Twin needles are the grammar of a dashboard.
- A rim of 60 minor ticks looked graduated but was a fixed *count*, so its
  spacing meant a different number of grams at every dose.
- Landmark ticks sat six units from band boundaries that were already the marks.
- The progress arc shared a radius with the bands and was drawn last, so it
  painted out the band you were in. The dial answered *how much* by erasing
  *which drink* — and the "you are here" highlight, being visible only on the
  unpoured remainder, was brightest **ahead** of the arc and vanished at the
  moment you crossed into the next drink.
- The band shading ran light–dark–light, which is the grammar of a green zone on
  a rev counter rather than three named things.
- And it ran from zero to a little past the lungo mark, so a third of the sweep
  was ratios below 1:1 where nothing ever is, while lungo was cut off at 1:3.36
  of a drink defined to 1:4.

What is left is `core/dial.js` and `core/gauge.js` rebuilt around what the dial
has to answer, in order: how much is in the cup, which drink is this and which
is next, how much longer.

**One shape, 240°, opening at the bottom, in every theme.** It used to hand one
theme a ring and everyone else a half circle — and only the ring branch drew
band labels at all, so in four of the five themes the dial was three unexplained
shades of accent. A theme changes the material; it does not change the
instrument. The opening at the bottom is what makes the middle available, which
is where a reading belongs.

**Anchored to the drinks, 1:1 to 1:4.** This is the change everything else falls
out of: band positions become constant at every dose — ristretto always ends at
0.233, espresso at 0.5 — so each name can be laid out once, curved along the
band it names, and can never collide with anything. That is why nothing on it is
ever abbreviated.

**Nothing overpaints anything.** Bands at one radius, progress on a neutral ring
inside them. The band you are in is the only saturated thing on the dial, lit
along its whole length rather than just the part you have not reached.

The reading sits inside it and carries the question that was missing: not the
ratio, which is in the tile row, but **how much longer** — `6.8 g to espresso`.

**And the tile fills.****And the tile fills.** The number sits over a level that rises as the shot
lands, with the three marks drawn where they fall in the volume, so passing one
is visible without reading anything. It is the same fraction of the same scale
as the dial, from the same call — a screen showing a dial at two thirds beside a
glass at half is a screen with two opinions.

Drawn the obvious way round it read as draining: tint the poured part of a
*bright* tile and the bright region is the empty one, shrinking as coffee
arrives. The first fix was to draw the space above the level instead, washed
out — which worked visually and broke something worse. Washing slid the ground
the number sits on from the accent toward the background, so the one number the
app exists for converged on its own backdrop in all five themes: 1.73:1 at
worst, and worst early in a shot when you are watching hardest.

The mistake was the bright tile. It is neutral now and the coffee is the
coloured thing, rising from the bottom. The number keeps one ground and stays
legible, the level still rises, and the screen stops carrying a flat slab of
saturated colour out of all proportion to what it encodes.

### The rest of brewkit, without dropping the link

The phone had exactly one page. Tapping through to the shot log meant navigating
away from `view.html`, and that destroys the peer connection — a WebRTC
description is good for one connection, so coming back meant pairing again.

But the log is already on the phone: every frame of the streamed log is written
into local storage by `core/backup.js`, so Shots, Advisor, Kit and Lab all work
on that device from data it already holds. The only thing that must not happen
is this page unloading. So the other pages open in a same-origin iframe over the
top, and the connection sits in a page that never navigates. The bar across the
top carries the pour — grams and seconds, still updating — and the link's own
status badge, because a link quietly dying behind an overlay is the one thing an
overlay could hide.

Escape or the back button returns to the shot, and the frame keeps its page, so
going back and forth is instant rather than a reload each way.

### The dose the laptop is using, not only the one it weighed

A reported bug worth writing down, because the shape of it recurs. The laptop
looked right and the iPad showed nothing extra: no dial, no volume, no ladder,
no name for the drink.

One null did all of that. `sess.dose` is only set once the dose step captures,
and plenty of real shots never let it — you go straight to brew, or you dose on
the grinder's own scale. The laptop hid that from itself by falling back to the
number in the target field whenever it needed a dose. The frame sent the raw
`sess.dose`, so the phone got `null`, and every one of those four things is
dose-derived. They did not fail; they correctly declined to draw.

The frame now carries the dose the laptop is actually using, with a `doseSet`
flag saying whether it was weighed or assumed — a ladder built on an assumed
dose is a plan rather than a measurement, and the strip labels it as one.

### Following the laptop, until you disagree

The viewer had no theme control at all, and no way to inherit one, so a dark
laptop beside a light phone was the normal case. The theme now rides along in
the frame — it costs a word ten times a second — and the phone wears it.

Following is not choosing. Pick a theme on the phone and that is a decision
about the phone: the laptop stops overriding it from then on.

### On the phone, three views

The job has three parts and each wants something different made big: the number
while you weigh, the curve while it pours, the verdict once it is done. The
viewer switches on the **step**, not on the brew state — the step is what the
person is doing, the brew state only what the puck is doing.

The last of the three is a summary and a row of ten buttons, because the channel
was always two-way and a rating tapped beside the machine seconds after the shot
is a better rating than one typed on a laptop in another room. It arrives on the
laptop as an ordinary session edit.

**The phone can now see the log, not only the pour.** It used to be a live
viewer and nothing else: the shots behind the shot needed an account on both
devices, which on an iPad meant the whole viewer was one failed sign-in away
from a blank page. The peer link already carries ten frames a second, and a year
of shots is smaller than a minute of that — so the phone asks, and the laptop
answers.

That goes down a **second data channel**, ordered and reliable, negotiated in
the same offer so pairing stays one exchange. The pour channel is deliberately
lossy: every frame carries the whole current state, so a dropped one costs
nothing and waiting for a retransmit would cost latency. A log is the opposite
in every respect — sent once, a dropped chunk loses shots, and nobody minds an
extra 40 ms. Two channels rather than a compromise between them. It is chunked
at 12 KB because browsers disagree about how large an SCTP message they will
carry and a refused one is refused silently, and the phone merges it with the
same union the Backup page uses, so asking twice can never cost a shot.

A pairing cannot be stored and reused — a WebRTC description is good for exactly
one connection. What can be stored is the fact that you have done it before,
which is the difference between a page of instructions and a page with a code on
it: both ends remember, the laptop's button becomes **Reconnect phone** and goes
straight to a fresh QR without explaining itself again, and the phone keeps the
short version with the explainer one tap away.

### Fitting a WebRTC description into a QR code

A QR code is only a shortcut if the phone reads it on the first try, and that is
a question of how much is in it. An offer as Chromium writes it runs to **560
characters** in the test container and longer on a laptop, which has more network
interfaces to advertise. This encoder tops out at version 15, holding 412 bytes
at the error correction level it uses, so a raw offer does not merely make a
grid too dense to read — it does not fit at all.

Almost none of those characters carry information the other end needs. An
SDP is mostly a codec catalogue, and this connection negotiates no audio and no
video — only data channels, which have no codecs to describe. What actually has
to survive the trip is five things: the ICE username fragment, the ICE password,
the DTLS certificate fingerprint, the setup role, and the host candidates.
`core/sdp.js` keeps those and rebuilds the rest from a fixed template, packing
the fingerprint from 95 hex characters to 32 bytes of base64 and each candidate
to a short token — an IPv4 address as four bytes and a port as two, an mDNS
candidate as its UUID packed to 16 bytes.

**560 characters become 87**, and the suite asserts that on a genuine offer
rather than a fixture. With the page URL in front of them that is 145,
which is a version 8 symbol — coarse enough that a phone reads it off a laptop
screen from across the counter. The test that matters is not that the
string round-trips: it is that the *rebuilt* description makes a working
connection, so the suite feeds an unpacked offer to a real `RTCPeerConnection`
and asserts the data channel reaches `open` and carries a message.

The encoder is written out in `core/qr.js` rather than pulled in, for the same
reason nothing else here is: this site has no build step and no dependencies.
It is byte mode at error-correction level M, versions 1 to 15, with the
standard's eight mask patterns scored on its four penalties. It is checked
against the published tables — capacity per version, Reed–Solomon codewords
divisible by their generator polynomial, the finder and timing patterns, and the
two copies of the format information agreeing with each other. Writing the
checks that way caught a real bug: the format-information run was laying down
eight bits where the standard says seven, quietly overwriting the module that is
always dark.

Reading a QR back is the asymmetric half. `BarcodeDetector` is in Chrome on
Android and absent or unreliable elsewhere — it is not in headless Chromium at
all — so the laptop's camera scan is offered when the browser has it and simply
not mentioned when it does not. The phone never needs it: it is following a URL,
which every phone camera has done for years.

### When the link drops

Wi-Fi on a phone in a kitchen is not a stable thing, and the old behaviour on a
dropped connection was to blank the screen — which is the worst moment to lose
the number, because it happens mid-shot. Now the last frame **stays on screen**,
dimmed, with a *Reconnecting…* badge over it, and the laptop gives the
connection a **four-second grace period** before it does anything. Most drops
recover inside that. Past it, the laptop restarts ICE on the existing
connection, which re-gathers candidates without a new pairing — so a phone that
moved between access points comes back on its own, and you only re-pair when the
connection is genuinely gone.

## Where the log lives, and getting it off this machine

Everything is in this browser's `localStorage`, on this computer. That survives
closing the tab, quitting the browser and shutting the machine down; it does not
survive clearing site data, and it is keyed per browser profile, so Chrome and
Firefox on the same machine hold separate logs. On boot the app asks for
[persistent storage](https://developer.mozilla.org/docs/Web/API/StorageManager/persist),
which exempts the log from being evicted under disk pressure — Chrome grants it
silently to a site you actually use, Safari has no such API and simply refuses,
so [Backup](https://mattlmccoy.github.io/espresso-brewkit/backup.html) reports
which answer you got rather than assuming the good one.

**There is no account and no server.** There used to be: the log synced through
Google Drive's `appDataFolder`, a hidden per-app folder in your own Drive. It
worked, and it is gone, because it could never work for anyone but the author.
`github.io` sits on the [Public Suffix List](https://publicsuffix.org/), so
Google treats it as a registry suffix like `.com` and refuses it as an
**Authorized domain** — which the branding page requires before a consent screen
can be published. An unpublished app admits only the accounts named on its
tester list, up to a hundred, added by hand. So the first run of a coffee log
was a support request, and the fix was not in this project's gift: it needed a
custom domain. Trading an account system for a file was the better trade.

[Backup](https://mattlmccoy.github.io/espresso-brewkit/backup.html) writes the
whole dataset — shots, bags, grinders, machines, supplies, adjustments — to one
dated JSON file, and reads one back. Shots alone still export as CSV from the
Shots page, which is the format to open in a spreadsheet.

There is a third file, for taking the log somewhere else entirely. The backup is
this app's internal state — storage keys as object keys, ids that mean nothing
outside it, curves packed into strings to keep the file small — which is right
for coming back here and wrong for going anywhere else. **Export for other
tools** writes flat records instead: coffee and grinder *names* rather than ids,
the units written into the file, and every curve expanded into plain
`[seconds, grams]` pairs. Nothing in it requires a reader to have seen this
project.

It is deliberately not labelled as any particular app's import format. Claiming
compatibility this project cannot verify against a real file from that app would
be worse than offering an honest open one — an import that silently drops half
your shots is not interoperability.

Restoring **merges rather than overwrites**. Shots are unioned by id, so pulling
shots on the laptop and rating them on the phone loses neither, and importing a
stale file cannot cost you a shot; where the same shot was edited on both sides
the later edit wins. Deletions travel as **tombstones**, because a union can
only ever add — without them, a shot deleted here would come straight back out
of the other device's file. That merge is the part with teeth, and it is pure,
so it is tested hard.

Because nothing is uploaded there is also no copy anywhere else, which is the
one thing the old sync did buy. So the nav carries a dot that lights the moment
your newest shot is newer than your newest backup file, on every page, and goes
out when you write one.

**On an iPhone or iPad this is a viewer and a logger.** No iOS browser has Web
Bluetooth — not Safari, and not Chrome, which is Safari underneath — so a phone
cannot stream the scale. It can read shots and curves, rate a shot, check what
is running low, and take weights by hand. Scale streaming stays on the computer.
That is Apple's decision, not something this project can work around.


### Proving it survives a restart

Every other test in the suite runs in an ephemeral browser context, which means
they would all pass whether or not the storage claim were true. So one of them
does not: it writes a shot, closes the browser entirely, opens a new one on the
same profile directory, and looks for the shot. That is the only test here that
exercises the thing the whole storage story rests on.

## Cues, for when you are not looking at the screen

The point of the phone viewer is that the laptop is elsewhere and your hands are
full. A number changing on a screen nobody is watching is not feedback. So both
ends can make noise: a rising pair when the dose lands in its window, a tick per
second over the last five before the yield target, a falling pair at the cut,
and a low buzz if flow starts climbing mid-shot. Pitch carries the meaning, so
they stay distinguishable across a room; the phone vibrates as well.

The tones are synthesised rather than shipped — three files to host and cache is
three ways to be silent on the device it matters most on. Audio cannot start
without a user gesture, strictest on iOS, so the switch says which of three
states it is in: off, on, or *tap to allow*.

Every cue fires on an **edge**. The conditions are sampled from a 10 Hz stream,
and a tone that repeats ten times a second is an alarm.

## The scale's battery

Every scale worth buying shows this on its own display, and a scale being driven
from a laptop across the room shows it to nobody. It is the standard SIG service
(`0x180F/0x2A19`), so this is a read rather than a decoder, with notifications
subscribed where offered since a level read once at connect is stale within the
hour. A scale that has no battery service simply does not get a badge.

## The flow, and how it reads the scale

The stepper, the prompt and the two things step 00 asks for all sit at the top
of the left column, because that is where a page is read from. They used to be
in the right-hand panel, which meant the flow began on the far side of the
screen from where the eye starts and the number ends up.

The dashboard is capped at the viewport height rather than merely asked to fill
it: `height: 100dvh`, not `min-height`, so a tall column shrinks the stage and
scrolls inside itself instead of pushing the whole page down. A minimum lets the
body grow to its content, which is exactly the scrolling the layout exists to
avoid.


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

**The middle column changes with the step.** While you are weighing there is
nothing on the chart worth the biggest panel on the page, so that space is a
dial — the same window geometry as the bar, on an arc big enough to read from
the machine — with what the last shot on this coffee did underneath it. The
chart slides in as the shot begins and the dial slides out.

**There is a bar for it.** Under the big readout, the dose is drawn against the
window you are aiming for: how far along you are, where the target sits, and how
wide a miss still counts. The window is a region rather than a line because that
is what it is — landing anywhere in it ends the step — and the scale runs past
it so an overshoot has somewhere to go, since a bar pinned at full tells you
that you are over but not by how much. The same bar follows the yield once the
shot is pouring, and the phone draws it from the same numbers.

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
                     bags and grinders, curve diagnosis, the two advisor models,
                     the file backup and its merge, the home-page walkthrough,
                     brew methods, scale gestures, curve-to-curve comparison
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
npm run check                 # parses every module the site ships, in about a second
```

`npm run check` exists because `node --check` covered the test harness and not
the app, which is the part that actually runs on someone's machine. A duplicate
declaration in a core module is a blank page, and finding that out seven minutes
into a Playwright run is six and a half minutes too late.

## Tests

`npm test` drives the site in a real browser and asserts on what actually renders.
Nearly six hundred assertions across the site in every theme: the analysis
results, the legacy CSV import path, the 3D drag interaction, theme persistence,
font loading, WCAG contrast on chrome pairs, grid alignment, horizontal overflow,
chart sizing, and the absence of rhetorical-question headings.

It takes about seven minutes, which is too long to run against a typo. `npm run
check` parses every module the site ships in about a second and is the thing to
run while working; the browser suite is the thing to run before pushing.

The models are tested against ground truth rather than against themselves. The
resistance fit is given shots generated from a known `log(Q) = a + b·grind + c·days`
and has to recover `b` and `c`; the recommendation has to match the closed-form
inverse; the curve metrics have to recover a flow profile whose peak, steady rate
and late slope are known by construction; and the filter has to survive a step, a
droplet impact, a slow pour and a whole shot. Refusals are tested too — the advisor
must decline to fit two shots, or eight shots all at the same setting, rather than
emitting a confident number. The QR encoder is held to the same standard in the
literal sense: its capacities, its Reed–Solomon codewords and its fixed patterns
are checked against ISO/IEC 18004 rather than against a snapshot of its own
output, which is what caught the format-information run writing one bit too many.

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

## Settings

Most of this app's configuration was already persisted somewhere. What was not
persisted anywhere was the set of numbers that decide how the session behaves —
how heavy a thing has to be before it counts as a dose, how long a reading has to
sit still before it is taken, how far from the target still counts as on target.

Those were constructor options on `SessionMachine` with sensible defaults and no
caller ever passing them, which is a particular kind of not-configurable: the
seam exists, the wire was never run. Every shot ever pulled used the defaults,
and the defaults were picked by reasoning about what a scale probably does rather
than by watching one. That mattered, because the capture rules misfired in a real
kitchen and the only remedy on offer was to edit the source.

`core/prefs.js` owns them now and `settings.html` shows them, each with the
sentence that explains what it does — the sentence lives beside the number, in
the module that declares it, because a threshold whose meaning lives in another
file will eventually be described wrongly. Only what you actually changed is
stored, so a later change to a default still reaches anyone who never disagreed
with the old one. Export a session's readings from Live first: the file shows
what your scale really does, which is the only honest way to set these.

The page also gathers what was reachable but hidden:

- **The Brix factor**, which had a write path with zero callers while silently
  governing the extraction yield derived for every shot in the log. The
  calculator let you change it for one calculation and then threw the change
  away.
- **The theme**, as five swatches in their own colours rather than a cycle button
  you press four times to see the third option — plus a way back to following the
  system, which there was no way to undo before.
- **The learned drip lag, per machine**, which was measured from your shots,
  used to call the stop early, and impossible to see, correct or start over.
- **The tap threshold**, previously behind a connected scale and a collapsed
  panel called "Device settings".
- **Discovery options**, which were real settings that reset on every page load,
  so a scale that needed them needed them typed in again on every visit.
- **Restoring hidden explanations**, whose one control was in the Live page
  footer — including for notes hidden on other pages.

### Design language

Hard edges and offset shadows, no border radius anywhere, Archivo Black for display
type, Space Mono for every number. One accent for chrome and data points, one for the
fitted line, one for anything flagged — so no colour has to mean two things at once.
Every theme is defined in `site/assets/css/app.css` as custom properties; the chart
module reads those properties and knows nothing about the palette, which is why
restyling the site does not touch the maths.

### What a design review found in the palette

Four reviewers went over every page in all five themes at laptop, iPad and phone
widths. The colour findings clustered onto two structural faults rather than a
list of bad choices.

**Three tokens were each doing two or three jobs**, against this file's own
stated rule that each has one. `--accent` painted chrome, data and state at
once; `--flag` meant both "hover" and "this is wrong", so a hovered table row
and a flagged outlier were the same pixels; `--fit` was the fitted line, the
danger fill and "worse than median". Splitting out `--hover` (a lift, not a
hue), `--fit-ink` and `--control` cost a few lines per theme and closed four
findings together.

**Components that hand-rolled `border: var(--bw) solid var(--ink)` instead of
wearing `.bx` silently opted out of the two themes that abolish borders.** That
was `.note`, `.tool-card` and `a.btn-link` — white-outlined rectangles in a
theme whose own comment says nothing is bordered.

Three measured failures are worth recording because every existing test was
happy with all of them:

- **Selection was invisible at 1.00:1** in Machined and Glass. Not a colour
  choice — a specificity loss. A themed `:is(.bx, …)` rule outranks a page's own
  `.thing[aria-current="true"]`, so every "this one is chosen" style was being
  replaced by the panel gradient. The ones that survived did so by tying and
  winning on source order, which is luck. Selection is now stated once per
  theme, after the component overrides.
- **Controls were invisible against their panels**, because Machined gave
  panels and buttons the same gradient: whether a button could be seen depended
  on where it happened to sit vertically inside its parent.
- **Placeholder text was the browser's `#757575` in every theme**, below AA
  against all five grounds, and a dead grey inside a phosphor screen. There was
  no `::placeholder` rule and no `color-scheme`, so the UA chose — which was
  also painting white checkboxes into four dark themes.

There is now a palette contract in the suite that asks these questions of every
theme directly, because the existing contrast test looked at chrome pairs and
all of this was in the tokens underneath.

**Five palettes**, and the last two are not palettes.

Light and dark follow the system preference until you pick one. Terminal is green
phosphor on black and one typeface for everything — not a novelty, but the
condition these pages are actually read in: almost entirely numbers, at arm's
length, beside a machine, often in a dark kitchen.

**Machined** is a lit instrument rather than a page with a different palette. The
first attempt at it was a recolour — the same hard-edged panels in grey and amber
— and it missed the point. What an appliance display looks like is not a palette,
it is a rendering model: nothing is drawn with an outline, everything is lit.
Surfaces glow faintly from within, an edge is a hairline of light rather than a
border, and the one thing that matters is a ring in the middle with the reading
inside it.

So it does three things a palette cannot. Every border becomes a light edge and
every panel a gradient with a direction. The shot becomes the only colour on the
screen. And the dial stops being a half circle and becomes a three-quarter ring
with a tick rim, an inner flow track and a travelling head — which is the part
CSS cannot reach, because a path's geometry is in the path. `core/gauge.js` holds
a table of which shape each theme wants, and reshaping keeps whatever reading was
on the dial: rebuilding it empty would blank it until the next sample, which on a
scale that has settled is forever.

It is drawn from the Meraki — three matte cylinders and a circular display on top,
with an interface reviewers describe as clean and functional rather than animated
— but from the machine's character, not from its screen. Every review page
carrying a close photograph of that display is unreachable from the sandbox this
was written in, so the palette is an interpretation and says so rather than
claiming a match.

**Glass** changes the material and nothing else. Same layout, same dial shape,
but translucent panes floating over a ground that has colour in it, each
blurring what is behind it, with edges that fade rather than stop.

**Bloom** is a palette and only a palette. The first version of it was a
redesign — pills instead of rectangles, sentence case forced over every label, a
lighter display face — and it was worse, instructively so. Forcing
`text-transform:none` fought each page's own CSS and won in some places and lost
in others, so half the headings shouted and half did not; capsule radius on a
swatch card crammed its label against the bottom. The complaint had never been
the structure. It was a harsh amber and a dial that looked like a rev counter,
so those are the two things that changed.

The plum and honey are not a taste decision. Those two are the chart's two
series, so they must be separable for a colourblind reader. The obvious soft
pair — dusty rose and sage — measured ΔE 3.3 for deuteran vision, which is
indistinguishable. Separation lives in lightness as much as in hue, which is why
these are a deep plum and a warm honey rather than two pastels.

The dial's finish softened in every theme, not only here: strokes down from 18px
and 9px to 7px and 2.5px with rounded ends, real gaps so the three drinks read as
three arcs rather than one graduated ring, names riding under the arcs they name,
and a short target tick outside the band instead of a needle crossing the whole
instrument. Machined's amber came down from a neon `#e9a44b` to a warmer tan, for
the same reason: on near-black it read as a warning light rather than as coffee.

### One spacing scale

The app read as squished, and the cause was arithmetic rather than taste: the
same "these two things are related" relationship was expressed four different
ways across four files. A field 14px from the next field, a hint 5px under its
own input, a grid gap of 14 and a panel gap of 22 — none of them agreeing about
what *related* means, so nothing grouped and everything crowded.

There is one scale now, in the tokens beside `--bw` and `--sh`: `--s1` through
`--s6`, where s2 binds a label to its field, s3 separates fields inside a row, s5
separates blocks, and s6 separates sections. The literals are gone from the
shared stylesheet and from the pages that were densest.

### Following the laptop, until you disagree### Following the laptop, until you disagree

The viewer had no theme control at all, and no way to inherit one, so a dark
laptop beside a light phone was the normal case. The theme now rides along in
the frame — it costs a word ten times a second — and the phone wears it.

Following is not choosing. Pick a theme on the phone and that is a decision
about the phone: the laptop stops overriding it from then on.

### On the phone, three views

The job has three parts and each wants something different made big: the number
while you weigh, the curve while it pours, the verdict once it is done. The
viewer switches on the **step**, not on the brew state — the step is what the
person is doing, the brew state only what the puck is doing.

The last of the three is a summary and a row of ten buttons, because the channel
was always two-way and a rating tapped beside the machine seconds after the shot
is a better rating than one typed on a laptop in another room. It arrives on the
laptop as an ordinary session edit.

**The phone can now see the log, not only the pour.** It used to be a live
viewer and nothing else: the shots behind the shot needed an account on both
devices, which on an iPad meant the whole viewer was one failed sign-in away
from a blank page. The peer link already carries ten frames a second, and a year
of shots is smaller than a minute of that — so the phone asks, and the laptop
answers.

That goes down a **second data channel**, ordered and reliable, negotiated in
the same offer so pairing stays one exchange. The pour channel is deliberately
lossy: every frame carries the whole current state, so a dropped one costs
nothing and waiting for a retransmit would cost latency. A log is the opposite
in every respect — sent once, a dropped chunk loses shots, and nobody minds an
extra 40 ms. Two channels rather than a compromise between them. It is chunked
at 12 KB because browsers disagree about how large an SCTP message they will
carry and a refused one is refused silently, and the phone merges it with the
same union the Backup page uses, so asking twice can never cost a shot.

A pairing cannot be stored and reused — a WebRTC description is good for exactly
one connection. What can be stored is the fact that you have done it before,
which is the difference between a page of instructions and a page with a code on
it: both ends remember, the laptop's button becomes **Reconnect phone** and goes
straight to a fresh QR without explaining itself again, and the phone keeps the
short version with the explainer one tap away.

### Fitting a WebRTC description into a QR code

A QR code is only a shortcut if the phone reads it on the first try, and that is
a question of how much is in it. An offer as Chromium writes it runs to **560
characters** in the test container and longer on a laptop, which has more network
interfaces to advertise. This encoder tops out at version 15, holding 412 bytes
at the error correction level it uses, so a raw offer does not merely make a
grid too dense to read — it does not fit at all.

Almost none of those characters carry information the other end needs. An
SDP is mostly a codec catalogue, and this connection negotiates no audio and no
video — only data channels, which have no codecs to describe. What actually has
to survive the trip is five things: the ICE username fragment, the ICE password,
the DTLS certificate fingerprint, the setup role, and the host candidates.
`core/sdp.js` keeps those and rebuilds the rest from a fixed template, packing
the fingerprint from 95 hex characters to 32 bytes of base64 and each candidate
to a short token — an IPv4 address as four bytes and a port as two, an mDNS
candidate as its UUID packed to 16 bytes.

**560 characters become 87**, and the suite asserts that on a genuine offer
rather than a fixture. With the page URL in front of them that is 145,
which is a version 8 symbol — coarse enough that a phone reads it off a laptop
screen from across the counter. The test that matters is not that the
string round-trips: it is that the *rebuilt* description makes a working
connection, so the suite feeds an unpacked offer to a real `RTCPeerConnection`
and asserts the data channel reaches `open` and carries a message.

The encoder is written out in `core/qr.js` rather than pulled in, for the same
reason nothing else here is: this site has no build step and no dependencies.
It is byte mode at error-correction level M, versions 1 to 15, with the
standard's eight mask patterns scored on its four penalties. It is checked
against the published tables — capacity per version, Reed–Solomon codewords
divisible by their generator polynomial, the finder and timing patterns, and the
two copies of the format information agreeing with each other. Writing the
checks that way caught a real bug: the format-information run was laying down
eight bits where the standard says seven, quietly overwriting the module that is
always dark.

Reading a QR back is the asymmetric half. `BarcodeDetector` is in Chrome on
Android and absent or unreliable elsewhere — it is not in headless Chromium at
all — so the laptop's camera scan is offered when the browser has it and simply
not mentioned when it does not. The phone never needs it: it is following a URL,
which every phone camera has done for years.

### When the link drops

Wi-Fi on a phone in a kitchen is not a stable thing, and the old behaviour on a
dropped connection was to blank the screen — which is the worst moment to lose
the number, because it happens mid-shot. Now the last frame **stays on screen**,
dimmed, with a *Reconnecting…* badge over it, and the laptop gives the
connection a **four-second grace period** before it does anything. Most drops
recover inside that. Past it, the laptop restarts ICE on the existing
connection, which re-gathers candidates without a new pairing — so a phone that
moved between access points comes back on its own, and you only re-pair when the
connection is genuinely gone.

## Where the log lives, and getting it off this machine

Everything is in this browser's `localStorage`, on this computer. That survives
closing the tab, quitting the browser and shutting the machine down; it does not
survive clearing site data, and it is keyed per browser profile, so Chrome and
Firefox on the same machine hold separate logs. On boot the app asks for
[persistent storage](https://developer.mozilla.org/docs/Web/API/StorageManager/persist),
which exempts the log from being evicted under disk pressure — Chrome grants it
silently to a site you actually use, Safari has no such API and simply refuses,
so [Backup](https://mattlmccoy.github.io/espresso-brewkit/backup.html) reports
which answer you got rather than assuming the good one.

**There is no account and no server.** There used to be: the log synced through
Google Drive's `appDataFolder`, a hidden per-app folder in your own Drive. It
worked, and it is gone, because it could never work for anyone but the author.
`github.io` sits on the [Public Suffix List](https://publicsuffix.org/), so
Google treats it as a registry suffix like `.com` and refuses it as an
**Authorized domain** — which the branding page requires before a consent screen
can be published. An unpublished app admits only the accounts named on its
tester list, up to a hundred, added by hand. So the first run of a coffee log
was a support request, and the fix was not in this project's gift: it needed a
custom domain. Trading an account system for a file was the better trade.

[Backup](https://mattlmccoy.github.io/espresso-brewkit/backup.html) writes the
whole dataset — shots, bags, grinders, machines, supplies, adjustments — to one
dated JSON file, and reads one back. Shots alone still export as CSV from the
Shots page, which is the format to open in a spreadsheet.

There is a third file, for taking the log somewhere else entirely. The backup is
this app's internal state — storage keys as object keys, ids that mean nothing
outside it, curves packed into strings to keep the file small — which is right
for coming back here and wrong for going anywhere else. **Export for other
tools** writes flat records instead: coffee and grinder *names* rather than ids,
the units written into the file, and every curve expanded into plain
`[seconds, grams]` pairs. Nothing in it requires a reader to have seen this
project.

It is deliberately not labelled as any particular app's import format. Claiming
compatibility this project cannot verify against a real file from that app would
be worse than offering an honest open one — an import that silently drops half
your shots is not interoperability.

Restoring **merges rather than overwrites**. Shots are unioned by id, so pulling
shots on the laptop and rating them on the phone loses neither, and importing a
stale file cannot cost you a shot; where the same shot was edited on both sides
the later edit wins. Deletions travel as **tombstones**, because a union can
only ever add — without them, a shot deleted here would come straight back out
of the other device's file. That merge is the part with teeth, and it is pure,
so it is tested hard.

Because nothing is uploaded there is also no copy anywhere else, which is the
one thing the old sync did buy. So the nav carries a dot that lights the moment
your newest shot is newer than your newest backup file, on every page, and goes
out when you write one.

**On an iPhone or iPad this is a viewer and a logger.** No iOS browser has Web
Bluetooth — not Safari, and not Chrome, which is Safari underneath — so a phone
cannot stream the scale. It can read shots and curves, rate a shot, check what
is running low, and take weights by hand. Scale streaming stays on the computer.
That is Apple's decision, not something this project can work around.


### Proving it survives a restart

Every other test in the suite runs in an ephemeral browser context, which means
they would all pass whether or not the storage claim were true. So one of them
does not: it writes a shot, closes the browser entirely, opens a new one on the
same profile directory, and looks for the shot. That is the only test here that
exercises the thing the whole storage story rests on.

## Cues, for when you are not looking at the screen

The point of the phone viewer is that the laptop is elsewhere and your hands are
full. A number changing on a screen nobody is watching is not feedback. So both
ends can make noise: a rising pair when the dose lands in its window, a tick per
second over the last five before the yield target, a falling pair at the cut,
and a low buzz if flow starts climbing mid-shot. Pitch carries the meaning, so
they stay distinguishable across a room; the phone vibrates as well.

The tones are synthesised rather than shipped — three files to host and cache is
three ways to be silent on the device it matters most on. Audio cannot start
without a user gesture, strictest on iOS, so the switch says which of three
states it is in: off, on, or *tap to allow*.

Every cue fires on an **edge**. The conditions are sampled from a 10 Hz stream,
and a tone that repeats ten times a second is an alarm.

## The scale's battery

Every scale worth buying shows this on its own display, and a scale being driven
from a laptop across the room shows it to nobody. It is the standard SIG service
(`0x180F/0x2A19`), so this is a read rather than a decoder, with notifications
subscribed where offered since a level read once at connect is stale within the
hour. A scale that has no battery service simply does not get a badge.

## The flow, and how it reads the scale

The stepper, the prompt and the two things step 00 asks for all sit at the top
of the left column, because that is where a page is read from. They used to be
in the right-hand panel, which meant the flow began on the far side of the
screen from where the eye starts and the number ends up.

The dashboard is capped at the viewport height rather than merely asked to fill
it: `height: 100dvh`, not `min-height`, so a tall column shrinks the stage and
scrolls inside itself instead of pushing the whole page down. A minimum lets the
body grow to its content, which is exactly the scrolling the layout exists to
avoid.


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

**The middle column changes with the step.** While you are weighing there is
nothing on the chart worth the biggest panel on the page, so that space is a
dial — the same window geometry as the bar, on an arc big enough to read from
the machine — with what the last shot on this coffee did underneath it. The
chart slides in as the shot begins and the dial slides out.

**There is a bar for it.** Under the big readout, the dose is drawn against the
window you are aiming for: how far along you are, where the target sits, and how
wide a miss still counts. The window is a region rather than a line because that
is what it is — landing anywhere in it ends the step — and the scale runs past
it so an overshoot has somewhere to go, since a bar pinned at full tells you
that you are over but not by how much. The same bar follows the yield once the
shot is pouring, and the phone draws it from the same numbers.

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
                     bags and grinders, curve diagnosis, the two advisor models,
                     the file backup and its merge, the home-page walkthrough,
                     brew methods, scale gestures, curve-to-curve comparison
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
npm run check                 # parses every module the site ships, in about a second
```

`npm run check` exists because `node --check` covered the test harness and not
the app, which is the part that actually runs on someone's machine. A duplicate
declaration in a core module is a blank page, and finding that out seven minutes
into a Playwright run is six and a half minutes too late.

## Tests

`npm test` drives the site in a real browser and asserts on what actually renders.
Nearly six hundred assertions across the site in every theme: the analysis
results, the legacy CSV import path, the 3D drag interaction, theme persistence,
font loading, WCAG contrast on chrome pairs, grid alignment, horizontal overflow,
chart sizing, and the absence of rhetorical-question headings.

It takes about seven minutes, which is too long to run against a typo. `npm run
check` parses every module the site ships in about a second and is the thing to
run while working; the browser suite is the thing to run before pushing.

The models are tested against ground truth rather than against themselves. The
resistance fit is given shots generated from a known `log(Q) = a + b·grind + c·days`
and has to recover `b` and `c`; the recommendation has to match the closed-form
inverse; the curve metrics have to recover a flow profile whose peak, steady rate
and late slope are known by construction; and the filter has to survive a step, a
droplet impact, a slow pour and a whole shot. Refusals are tested too — the advisor
must decline to fit two shots, or eight shots all at the same setting, rather than
emitting a confident number. The QR encoder is held to the same standard in the
literal sense: its capacities, its Reed–Solomon codewords and its fixed patterns
are checked against ISO/IEC 18004 rather than against a snapshot of its own
output, which is what caught the format-information run writing one bit too many.

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

## Settings

Most of this app's configuration was already persisted somewhere. What was not
persisted anywhere was the set of numbers that decide how the session behaves —
how heavy a thing has to be before it counts as a dose, how long a reading has to
sit still before it is taken, how far from the target still counts as on target.

Those were constructor options on `SessionMachine` with sensible defaults and no
caller ever passing them, which is a particular kind of not-configurable: the
seam exists, the wire was never run. Every shot ever pulled used the defaults,
and the defaults were picked by reasoning about what a scale probably does rather
than by watching one. That mattered, because the capture rules misfired in a real
kitchen and the only remedy on offer was to edit the source.

`core/prefs.js` owns them now and `settings.html` shows them, each with the
sentence that explains what it does — the sentence lives beside the number, in
the module that declares it, because a threshold whose meaning lives in another
file will eventually be described wrongly. Only what you actually changed is
stored, so a later change to a default still reaches anyone who never disagreed
with the old one. Export a session's readings from Live first: the file shows
what your scale really does, which is the only honest way to set these.

The page also gathers what was reachable but hidden:

- **The Brix factor**, which had a write path with zero callers while silently
  governing the extraction yield derived for every shot in the log. The
  calculator let you change it for one calculation and then threw the change
  away.
- **The theme**, as five swatches in their own colours rather than a cycle button
  you press four times to see the third option — plus a way back to following the
  system, which there was no way to undo before.
- **The learned drip lag, per machine**, which was measured from your shots,
  used to call the stop early, and impossible to see, correct or start over.
- **The tap threshold**, previously behind a connected scale and a collapsed
  panel called "Device settings".
- **Discovery options**, which were real settings that reset on every page load,
  so a scale that needed them needed them typed in again on every visit.
- **Restoring hidden explanations**, whose one control was in the Live page
  footer — including for notes hidden on other pages.

### Design language

Hard edges and offset shadows, no border radius anywhere, Archivo Black for display
type, Space Mono for every number. One accent for chrome and data points, one for the
fitted line, one for anything flagged — so no colour has to mean two things at once.
Every theme is defined in `site/assets/css/app.css` as custom properties; the chart
module reads those properties and knows nothing about the palette, which is why
restyling the site does not touch the maths.

### What a design review found in the palette

Four reviewers went over every page in all five themes at laptop, iPad and phone
widths. The colour findings clustered onto two structural faults rather than a
list of bad choices.

**Three tokens were each doing two or three jobs**, against this file's own
stated rule that each has one. `--accent` painted chrome, data and state at
once; `--flag` meant both "hover" and "this is wrong", so a hovered table row
and a flagged outlier were the same pixels; `--fit` was the fitted line, the
danger fill and "worse than median". Splitting out `--hover` (a lift, not a
hue), `--fit-ink` and `--control` cost a few lines per theme and closed four
findings together.

**Components that hand-rolled `border: var(--bw) solid var(--ink)` instead of
wearing `.bx` silently opted out of the two themes that abolish borders.** That
was `.note`, `.tool-card` and `a.btn-link` — white-outlined rectangles in a
theme whose own comment says nothing is bordered.

Three measured failures are worth recording because every existing test was
happy with all of them:

- **Selection was invisible at 1.00:1** in Machined and Glass. Not a colour
  choice — a specificity loss. A themed `:is(.bx, …)` rule outranks a page's own
  `.thing[aria-current="true"]`, so every "this one is chosen" style was being
  replaced by the panel gradient. The ones that survived did so by tying and
  winning on source order, which is luck. Selection is now stated once per
  theme, after the component overrides.
- **Controls were invisible against their panels**, because Machined gave
  panels and buttons the same gradient: whether a button could be seen depended
  on where it happened to sit vertically inside its parent.
- **Placeholder text was the browser's `#757575` in every theme**, below AA
  against all five grounds, and a dead grey inside a phosphor screen. There was
  no `::placeholder` rule and no `color-scheme`, so the UA chose — which was
  also painting white checkboxes into four dark themes.

There is now a palette contract in the suite that asks these questions of every
theme directly, because the existing contrast test looked at chrome pairs and
all of this was in the tokens underneath.

**Five palettes**, and the last two are not palettes.

Light and dark follow the system preference until you pick one. Terminal is green
phosphor on black and one typeface for everything — not a novelty, but the
condition these pages are actually read in: almost entirely numbers, at arm's
length, beside a machine, often in a dark kitchen.

**Machined** is a lit instrument rather than a page with a different palette. The
first attempt at it was a recolour — the same hard-edged panels in grey and amber
— and it missed the point. What an appliance display looks like is not a palette,
it is a rendering model: nothing is drawn with an outline, everything is lit.
Surfaces glow faintly from within, an edge is a hairline of light rather than a
border, and the one thing that matters is a ring in the middle with the reading
inside it.

So it does three things a palette cannot. Every border becomes a light edge and
every panel a gradient with a direction. The shot becomes the only colour on the
screen. And the dial stops being a half circle and becomes a three-quarter ring
with a tick rim, an inner flow track and a travelling head — which is the part
CSS cannot reach, because a path's geometry is in the path. `core/gauge.js` holds
a table of which shape each theme wants, and reshaping keeps whatever reading was
on the dial: rebuilding it empty would blank it until the next sample, which on a
scale that has settled is forever.

It is drawn from the Meraki — three matte cylinders and a circular display on top,
with an interface reviewers describe as clean and functional rather than animated
— but from the machine's character, not from its screen. Every review page
carrying a close photograph of that display is unreachable from the sandbox this
was written in, so the palette is an interpretation and says so rather than
claiming a match.

**Glass** changes the material and nothing else. Same layout, same dial shape,
but translucent panes floating over a ground that has colour in it, each
blurring what is behind it, with edges that fade rather than stop.

**Bloom** is the answer to a second complaint about the dial: not that it was
unreadable, but that it was *unlovely*. Thick strokes, amber on near-black, mono
capitals — a rev counter. Correct for a machine, wrong for the thing the machine
is making.

So the geometry stays an instrument and the finish stops being one. Warm oat and
blush rather than black; plum and honey rather than amber and cyan; hairlines and
soft shadows rather than marker outlines and stacked paper; and sentence case
throughout, because small caps with wide tracking is a telemetry idiom while
small text with wide tracking is an editorial one, and the difference is entirely
the capitals.

The plum and honey are not a taste decision. Those two are the chart's two
series, so they have to be separable for a colourblind reader. The first soft
pair — dusty rose and sage — measured ΔE 3.3 for deuteran vision, which is
indistinguishable. These clear every check, and that is why they are a deep plum
and a warm honey rather than two pastels: separation lives in lightness as much
as in hue.

The dial's own finish softened everywhere, not only here: thin strokes with
rounded ends, real gaps so the three drinks read as three arcs rather than one
graduated ring, names in sentence case riding under the bands they name, and a
short target tick outside the band instead of a needle crossing the whole
instrument.

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

`.github/workflows/pages.yml` builds and deploys `site/` on every push to `main`.
It needs **Settings → Pages → Source: GitHub Actions** enabled once.

## Video

The original project walkthrough, from the Python era:
<https://www.youtube.com/watch?v=FDcUICSV3XE>

## License

MIT — see [LICENSE](LICENSE).
