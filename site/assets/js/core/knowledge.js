// What is actually known about pulling espresso, and how well.
//
// WHY THIS FILE EXISTS
// Every threshold in this app used to be a number typed inline next to the code
// that tested it — "conventions read off a lot of espresso curves", as
// diagnose.js honestly put it. That is fine until the app starts telling people
// what to change, at which point the difference between "measured in a
// controlled study" and "repeated confidently on a forum" is the difference
// between advice and folklore. Espresso is unusually full of the second kind.
//
// So each claim here carries its evidence class, and the app is required to
// speak differently depending on which it is:
//
//   established  Peer-reviewed, or independently measured more than once.
//                The app may state it flatly.
//   practice     Widely repeated by credible practitioners, weakly evidenced,
//                mechanistically plausible. The app must hedge: "usually",
//                "often", "worth trying".
//   contested    Credible sources actively disagree. The app must name the
//                disagreement rather than pick a side.
//
// And REFUTED, at the bottom, is the list of things the app must NOT say —
// including several that this app itself was saying before this file existed.
//
// HOW IT WAS COMPILED
// Three research passes over the primary literature and the serious
// practitioner sources. A caveat that belongs in the open: the machine doing
// the reading could not fetch pages directly — the network policy blocked it —
// so it worked from search-engine summaries of those sources plus the
// citations. The DOIs and URLs are right and the claims are traceable, but a
// number tagged `verify` below is one nobody has yet read off the primary page
// with their own eyes. They are marked so they can be checked rather than
// quietly trusted.
//
// A finding worth stating separately: all three passes independently turned up
// numbers that look authoritative, circulate widely, and appear to have no
// source at all. Several cite studies that do not exist. Those are in REFUTED
// too, because the useful thing for a tool like this is not only knowing what
// is true but knowing which plausible-sounding numbers to refuse.

/* ------------------------------------------------------------------ sources */

export const SOURCES = {
  cameron2020: {
    what: 'Cameron, Morisco, Hofstetter, Hendon et al., "Systematically Improving '
      + 'Espresso: Insights from Mathematical Modeling and Experiment", Matter 2(3), 2020',
    url: 'https://www.cell.com/matter/fulltext/S2590-2385(19)30410-2',
  },
  smrke2024: {
    what: 'Smrke, Eiermann & Yeretzian, "The role of fines in espresso extraction '
      + 'dynamics", Scientific Reports 14, 2024',
    url: 'https://www.nature.com/articles/s41598-024-55831-x',
  },
  uman2016: {
    what: 'Uman et al., "The effect of bean origin and temperature on grinding '
      + 'roasted coffee", Scientific Reports 6:24483, 2016',
    url: 'https://www.nature.com/articles/srep24483',
  },
  poro2026: {
    what: 'Waszkiewicz et al., "Under pressure: poroelastic regulation of flow in '
      + 'espresso brewing", Physics of Fluids 38(6), 2026',
    url: 'https://arxiv.org/abs/2512.21528',
  },
  klotz2020: {
    what: 'Klotz, Winkler & Lachenmeier, "Influence of the Brewing Temperature on '
      + 'the Taste of Espresso", Foods 9(1):36, 2020',
    url: 'https://doi.org/10.3390/foods9010036',
  },
  cotter2021: {
    what: 'Cotter, Batali & Guinard, "Consumer preferences for black coffee are '
      + 'spread over a wide range of brew strengths and extraction yields", '
      + 'J. Food Sci., 2021',
    url: 'https://ift.onlinelibrary.wiley.com/doi/10.1111/1750-3841.15561',
  },
  harper2023: {
    what: 'Mendez Harper, Hendon et al., "Moisture-controlled triboelectrification '
      + 'during coffee grinding", Matter, 2023',
    url: 'https://www.cell.com/matter/fulltext/S2590-2385(23)00568-4',
  },
  gagnePsd: {
    what: 'Jonathan Gagné, "What I learned from analyzing 300 particle size '
      + 'distributions for 24 espresso grinders", Coffee ad Astra, 2023',
    url: 'https://coffeeadastra.com/2023/09/21/what-i-learned-from-analyzing-300-particle-size-distributions-for-24-espresso-grinders/',
  },
  gagnePuck: {
    what: 'Jonathan Gagné, "A study of espresso puck resistance and how puck '
      + 'preparation affects it", Coffee ad Astra, 2021',
    url: 'https://coffeeadastra.com/2021/01/16/a-study-of-espresso-puck-resistance-and-how-puck-preparation-affects-it/',
  },
  gagneAstringency: {
    what: 'Jonathan Gagné, "The Mechanism Behind Astringency in Coffee", Coffee ad Astra, 2022',
    url: 'https://coffeeadastra.com/2022/08/01/the-mechanism-behind-astringency-in-coffee/',
  },
  raoAstringency: {
    what: 'Scott Rao, "Managing astringency in coffee brewing", 2020',
    url: 'https://www.scottrao.com/blog/2020/10/9/managing-astringency-in-coffee-brewing',
  },
  raoCurves: {
    what: 'Scott Rao, "Extraction curve analysis", 2019',
    url: 'https://www.scottrao.com/blog/2019/4/6/extraction-curve-analysis',
  },
  raoMyths: {
    what: 'Scott Rao, "The twin myths of ‘easier to extract’ and ‘overextraction’"',
    url: 'https://www.scottrao.com/blog/extraction-myths',
  },
  decentCurves: {
    what: 'Decent Espresso, "Why is the flow curve shaped differently with '
      + 'different coffees or grinders?"',
    url: 'https://decentespresso.com/blog/why_is_the_flow_curve_shaped_differently_with_different_coffees_or_grinders',
  },
  decentNineBar: {
    what: 'Decent Espresso, "The nine bar question"',
    url: 'https://decentespresso.com/blog/the_nine_bar_question',
  },
  socraticTamp: {
    what: 'Socratic Coffee, "The impact of tamping pressure on espresso extraction", 2015',
    url: 'https://socraticcoffee.com/2015/07/the-impact-of-tamping-pressure-on-espresso-extraction/',
  },
  socraticOcd: {
    what: 'Socratic Coffee, "Examining the impact of the OCD on total dissolved '
      + 'solids extraction", 2016',
    url: 'https://socraticcoffee.com/2016/12/examining-the-impact-of-the-ocd-on-total-dissolved-solids-extraction/',
  },
  bhChart: {
    what: 'Barista Hustle, "Towards a Common Coffee Control Chart"',
    url: 'https://www.baristahustle.com/towards-a-common-coffee-control-chart/',
  },
  bhChannel: {
    what: 'Barista Hustle, "If Not Channelling, Then What?"',
    url: 'https://www.baristahustle.com/if-not-channelling-then-what/',
  },
  guinard2023: {
    what: 'Guinard et al., "A new Coffee Brewing Control Chart", J. Food Sci., 2023',
    url: 'https://ift.onlinelibrary.wiley.com/doi/full/10.1111/1750-3841.16531',
  },
};

/* ------------------------------------------------------------------- claims */

/**
 * The statements the app is allowed to make, each with its evidence class.
 *
 * `say` is written to be shown to a person mid-shot or just after one, so it is
 * one or two sentences and it leads with the consequence rather than the
 * mechanism. `because` carries the reasoning for anyone who opens it.
 */
export const CLAIMS = {
  fallingResistance: {
    confidence: 'established',
    say: 'Flow rising through a shot is normal, not a fault.',
    because: 'Puck resistance falls as the bed saturates, erodes and the slurry thins, so '
      + 'at constant pressure the flow climbs. Decent, who have more shot data than anyone, '
      + 'call the reduction in puck resistance "pretty much universal". A channel is a step '
      + 'change, not a gentle climb.',
    sources: ['decentCurves', 'gagnePuck'],
  },
  channelIsAStep: {
    confidence: 'established',
    say: 'A channel shows up as a sudden step in flow, not a gradual rise.',
    because: 'Preferential flow is a positive-feedback instability: a small defect takes a '
      + 'disproportionate share of the water and then erodes itself wider. That makes it '
      + 'discrete. Normal shot evolution is smooth and monotonic.',
    sources: ['gagnePuck', 'raoCurves'],
  },
  noPressureTrace: {
    confidence: 'established',
    say: 'A flow spike alone cannot prove a channel — that needs the pressure trace too.',
    because: 'On a pressure-controlled machine a channel is a flow spike WITH a simultaneous '
      + 'pressure dip, because the pump cannot hold target through a sudden loss of '
      + 'resistance. A scale sees only weight against time, so a spike here is consistent '
      + 'with a channel, with the machine ramping, or with the cup being nudged.',
    sources: ['decentCurves', 'gagnePuck'],
  },
  varianceDiscriminates: {
    confidence: 'practice',
    say: 'Slow but repeatable is a grind problem. Slow and erratic is a channelling problem.',
    because: 'Channelling is a different accident each time, so it shows up as spread across '
      + 'shots at unchanged settings. A grind that is simply too fine is reliably slow. This '
      + 'is the one diagnosis a shot log can make and a single shot cannot.',
    sources: ['gagnePuck', 'cameron2020'],
  },
  finerIsNotMonotonic: {
    confidence: 'established',
    say: 'Grinding finer stops raising extraction past a point, and then lowers it.',
    because: 'Measured extraction against grind setting has a peak. Past it, flow goes '
      + 'inhomogeneous — clogging and channelling cut the effective surface area — so shots '
      + 'get slower AND less extracted AND less repeatable at once. The homogeneous-flow '
      + 'model that predicts "finer is always more" is the thing the experiment falsified.',
    sources: ['cameron2020'],
  },
  doseDown: {
    confidence: 'established',
    say: 'Lowering the dose and coarsening can reach the same extraction far more repeatably.',
    because: 'A deeper bed extracts less evenly, because water reaching the bottom is already '
      + 'loaded with solubles. Cameron went 20 g to 15 g with a coarser grind and got equal '
      + 'yield with much better reproducibility.',
    sources: ['cameron2020'],
  },
  finesDominate: {
    confidence: 'established',
    say: 'Two grinders at the same grind size can pull very differently.',
    because: 'Adding sieved fines back at a fixed median particle size reduces permeability '
      + 'and lengthens the shot on its own. Extraction time is predictable from the share of '
      + 'fines plus the main particle size — grind size alone is an incomplete description.',
    sources: ['smrke2024'],
  },
  ratioSetsEy: {
    confidence: 'established',
    say: 'Extraction yield is the ratio times the strength, so a short shot cannot be a high-yield one.',
    because: 'EY = ratio x TDS, which is arithmetic rather than opinion. At 1:1 you would need '
      + '20% TDS to reach 20% yield, and espresso does not get there. A ristretto is a '
      + 'structurally low-yield drink — typically 13 to 17% — and that is not a defect.',
    sources: ['bhChart'],
  },
  eyBandIsInherited: {
    confidence: 'contested',
    say: 'The 18–22% window came from 1950s drip research, not from espresso.',
    because: 'It is Lockhart’s Coffee Brewing Control Chart, derived from American drip '
      + 'coffee and mid-century panels. The SCA’s own later funded work found preference '
      + 'spread far wider than one box, and split into segments that prefer opposite ends. '
      + 'Rao argues true over-extraction is nearly unreachable and that what gets called it is '
      + 'astringency from channelling. Gagné reframes the ceiling as a property of how '
      + 'evenly you extract, not of the coffee.',
    sources: ['cotter2021', 'guinard2023', 'raoMyths'],
  },
  bothEndsAtOnce: {
    confidence: 'established',
    say: 'Sour and bitter together is not "in between" — it is both ends of the puck at once.',
    because: 'Water strips the coffee along its path and barely wets the rest, and both go '
      + 'into the same cup. Splitting the difference on grind makes both halves worse. The fix '
      + 'is evenness, not a smaller step in either direction.',
    sources: ['cameron2020', 'gagneAstringency', 'raoAstringency'],
  },
  astringencyIsTactile: {
    confidence: 'established',
    say: 'Drying and rough is a mouthfeel, not a taste, and it has the opposite fix to bitter.',
    because: 'Large polyphenols bind salivary proteins and strip lubrication. They come out '
      + 'through channels that reach the base of the bed, which is why astringency is the one '
      + 'defect where grinding finer is almost always the wrong move.',
    sources: ['gagneAstringency', 'raoAstringency'],
  },
  tampForce: {
    confidence: 'established',
    say: 'How hard you tamp does not matter. Level and consistent does.',
    because: 'Tested at 5, 10, 15 and 20 kg with ten shots each: no significant difference in '
      + 'strength or yield. Replicated independently at 10 lb against 40 lb. Three groups, '
      + 'consistent null. The 30 lb tamp is ritual.',
    sources: ['socraticTamp'],
  },
  distributorsCanHurt: {
    confidence: 'practice',
    say: 'Spinning distribution tools are not free — one tested worse than using nothing.',
    because: 'Over more than a hundred shots the OCD produced consistently lower strength than '
      + 'other distributors and than no distributor at all. Deep stirring (WDT) is the '
      + 'puck-prep step with actual measured support, and what it improves is consistency '
      + 'rather than average yield.',
    sources: ['socraticOcd', 'gagnePuck'],
  },
  varianceNotMean: {
    confidence: 'practice',
    say: 'Nearly everything that survives testing improves consistency, not average extraction.',
    because: 'Deep WDT, precision baskets and pre-infusion all move spread rather than mean. '
      + 'Advice framed as "this will raise your yield" is usually overclaiming; "this will make '
      + 'your shots repeatable" is usually the honest version.',
    sources: ['gagnePuck', 'socraticTamp'],
  },
  ninebar: {
    confidence: 'contested',
    say: 'Nine bar is inherited from lever-machine geometry, not chosen by measurement.',
    because: 'Gaggia’s 1946 spring produced about nine bar as a consequence of its design '
      + 'and pump machines were built to imitate it. Measured flow rises with pressure only to '
      + 'around 4.5 bar and is nearly flat from 7 to 11, because the wet puck is poroelastic — '
      + 'above a point, more pressure compacts the bed as fast as it pushes water.',
    sources: ['poro2026', 'decentNineBar'],
  },
  tempIsSelectivity: {
    confidence: 'contested',
    say: 'Temperature changes which compounds come out more than how much does.',
    because: 'Two shots extracted to the same yield at different temperatures taste different. '
      + 'But a triangle-test panel could not reliably tell 80 °C from 93 °C '
      + '— 11 of 24, against 8 by chance. A degree is very unlikely to be the thing wrong '
      + 'with your shot.',
    sources: ['klotz2020'],
  },
  freshIsNotBetter: {
    confidence: 'practice',
    say: 'Espresso has a rest window. Too fresh channels; too old goes flat.',
    because: 'CO2 evolving inside a pressurised bed disrupts it, which reads as fast, erratic '
      + 'flow and early blonding. Roughly 40% of the gas leaves in the first day. Dark roasts '
      + 'are porous and settle in 3 to 7 days; light roasts hold gas longer and often want two '
      + 'to three weeks, sometimes much more.',
    sources: [],
  },
  cremaIsNotQuality: {
    confidence: 'established',
    say: 'Crema tracks how much gas is in the coffee, not how well you pulled it.',
    because: 'It is a CO2 foam. Robusta and dark roasts make plenty regardless of skill, and a '
      + 'well-extracted shot on rested light-roast coffee can look thin.',
    sources: [],
  },
  rdt: {
    confidence: 'established',
    say: 'A few drops of water on the beans halves the static and most of the retention.',
    because: 'About 10 microlitres per gram cuts charge on the grounds by around half and takes '
      + 'retention from over 10% to about 2.5% on dark roasts. Its effect on extraction is a '
      + 'separate and disputed question, and if real it is around half a percentage point.',
    sources: ['harper2023'],
  },
  processIsDensity: {
    confidence: 'contested',
    say: 'Washed or natural does not change your grinder. It changes where on its range you land.',
    because: 'Particle size distribution measured across origins and processes came out '
      + 'independent of both. What the bean changes is density and how it fractures, which '
      + 'moves the median size you get at a given setting; the fines then follow the grinder’s '
      + 'own fixed curve. If you record one thing about a bean, record its density.',
    sources: ['uman2016'],
  },
  burrDiameter: {
    confidence: 'established',
    say: 'Bigger burrs do not measurably grind more evenly.',
    because: 'Across 300 particle size distributions from 24 espresso grinders, burr diameter '
      + 'did not systematically predict uniformity. Flat burrs came out on average more even '
      + 'than conical, but the distributions overlap heavily and alignment was uncontrolled — '
      + 'so "flat versus conical" and "aligned versus not" are not separated in the best data '
      + 'anyone has.',
    sources: ['gagnePsd'],
  },
};

/* --------------------------------------------------------------- taste map */

/**
 * What a taste means, ranked by how often it is the cause.
 *
 * `structure` is the thing to get right before any advice is given, because the
 * three classes take opposite fixes:
 *   under   — extract more
 *   over    — extract less
 *   uneven  — extract more evenly; changing the amount makes both halves worse
 *
 * The single most valuable rule in this file: two opposite defects reported at
 * once, or any dryness, means `uneven`. That is not a compromise between sour
 * and bitter and must not be treated as one.
 */
export const TASTE = {
  sour: {
    structure: 'under',
    label: 'Sour',
    causes: [
      { why: 'Ground too coarse for the ratio', fix: 'Finer — but read the peak warning below', confidence: 'established' },
      { why: 'Ratio too short; the shot was cut early', fix: 'Take it further, 1:2 toward 1:2.5', confidence: 'established' },
      { why: 'A light roast on a medium-roast recipe', fix: 'Longer ratio and more heat before finer grind', confidence: 'practice' },
      { why: 'Coffee too fresh, under about five days', fix: 'Rest it', confidence: 'practice' },
      { why: 'Brew temperature low', fix: 'Up one or two degrees', confidence: 'contested' },
    ],
    // Asked before any advice is given, because a yes moves it to `uneven`.
    check: 'Is there any bitterness or dryness with it?',
  },
  bitter: {
    structure: 'over',
    label: 'Bitter',
    causes: [
      { why: 'The roast itself — dark roasts carry bitterness no brewing removes', fix: 'Shorter ratio, cooler', confidence: 'established' },
      { why: 'Ratio too long for this coffee', fix: 'Pull it shorter', confidence: 'practice' },
      { why: 'Old coffee, past three or four weeks', fix: 'Fresher bag', confidence: 'practice' },
      { why: 'Rancid oils in the group or the basket', fix: 'Backflush and scrub the basket — this is the one nobody checks', confidence: 'practice' },
      { why: 'Brew temperature high for the roast', fix: 'Down a couple of degrees', confidence: 'contested' },
    ],
    check: 'Is the finish also drying or rough?',
  },
  harsh: {
    structure: 'uneven',
    label: 'Drying or rough',
    causes: [
      { why: 'Channels reaching the base of the bed, carrying the astringent molecules out', fix: 'Stir the grounds deeply, tamp level', confidence: 'practice' },
      { why: 'Ground too fine, so the pressure gradient exploits every flaw harder', fix: 'Coarser', confidence: 'practice' },
      { why: 'Pressure onset too abrupt', fix: 'Longer, gentler pre-infusion', confidence: 'practice' },
      { why: 'Dose too high for the basket', fix: 'A gram or two less', confidence: 'practice' },
    ],
    check: null,
  },
  thin: {
    structure: 'under',
    label: 'Thin or watery',
    causes: [
      { why: 'Ratio too long — the most common and most overlooked', fix: 'Back toward 1:2', confidence: 'established' },
      { why: 'Ground too coarse', fix: 'Finer', confidence: 'established' },
      { why: 'Channelling, so most of the bed never extracted', fix: 'Puck prep', confidence: 'established' },
      { why: 'Under-dosed for the basket', fix: 'Up to the basket’s rating', confidence: 'practice' },
      { why: 'A light roast, which genuinely has less body', fix: 'May be the coffee rather than the shot', confidence: 'practice' },
    ],
    check: null,
  },
  hollow: {
    structure: 'uneven',
    label: 'Edges but no middle',
    causes: [
      { why: 'Uneven extraction — the extremes survive and the middle is what goes', fix: 'Puck prep, then coarser', confidence: 'practice' },
      { why: 'A grinder making both fines and boulders', fix: 'Check burr alignment; this one persists across every setting', confidence: 'practice' },
      { why: 'Stale coffee — the aromatics that make the mid-palate go first', fix: 'Fresher bag', confidence: 'established' },
      { why: 'Ratio too long, so it is diluted rather than uneven', fix: 'Shorter. Thin-and-hollow is dilution; drying-and-hollow is unevenness', confidence: 'practice' },
    ],
    check: null,
  },
  ashy: {
    structure: 'over',
    label: 'Ashy or burnt',
    causes: [
      { why: 'The roast — carbonised sugars, not a brewing fault', fix: 'Shorter ratio and cooler, or a lighter roast', confidence: 'established' },
      { why: 'Rancid oils in the machine or the grinder', fix: 'Clean before touching the recipe', confidence: 'practice' },
      { why: 'Coffee well past its window', fix: 'Fresher bag', confidence: 'practice' },
    ],
    check: null,
  },
  salty: {
    structure: 'under',
    label: 'Salty',
    causes: [
      { why: 'Water — a sodium ion-exchange softener literally adds sodium', fix: 'Ask about the water first; it is the highest-yield question and nobody asks it', confidence: 'established' },
      { why: 'Very low extraction, so early minerals dominate before the sugars arrive', fix: 'Longer ratio, finer, hotter', confidence: 'practice' },
      { why: 'Scale shedding from a limed-up boiler', fix: 'Descale', confidence: 'practice' },
    ],
    check: null,
  },
  syrupy: {
    structure: 'under',
    label: 'Heavy but muted',
    causes: [
      { why: 'Ratio too short — a ristretto by accident', fix: 'Out to 1:2.2 or 1:2.5', confidence: 'established' },
      { why: 'Ground fine enough to be past the peak: strong early, low yield overall', fix: 'Coarser AND longer', confidence: 'established' },
      { why: 'A dark roast pulled short', fix: 'This may be the drink you meant, if it is going into milk', confidence: 'practice' },
      { why: 'Stale — body outlasts aromatics, so old coffee is thick and boring', fix: 'Fresher bag', confidence: 'practice' },
    ],
    check: null,
  },
};

/** Taste tags that, seen together, mean unevenness rather than either one. */
export const OPPOSED = [['sour', 'bitter'], ['sour', 'ashy'], ['thin', 'harsh']];

/* -------------------------------------------------------------- curve shapes */

/**
 * What the shape of a weight-against-time curve supports concluding.
 *
 * Deliberately conservative. This app has a scale and nothing else: no pressure
 * channel, no flow meter. Several readings that would be solid with a pressure
 * trace are only suggestive without one, and they say so rather than borrowing
 * confidence from a signal that is not there.
 */
export const CURVES = {
  healthy: {
    label: 'Normal',
    say: 'Slow start, a smooth climb, easing at the cut. That is what a puck holding '
      + 'together does.',
    confidence: 'established',
    sources: ['decentCurves'],
  },
  stepChange: {
    label: 'A step in the flow',
    say: 'Flow jumped rather than climbed. That is the shape a channel makes — though '
      + 'without a pressure reading it could also be the machine ramping or the cup being '
      + 'knocked.',
    confidence: 'established',
    hedge: 'noPressureTrace',
    sources: ['gagnePuck', 'raoCurves'],
  },
  sagThenCollapse: {
    label: 'Rose, then fell away',
    say: 'Flow built and then could not be sustained. Usually the grind is fine enough that '
      + 'the puck compresses under full pressure.',
    confidence: 'practice',
    sources: ['raoCurves'],
  },
  gusher: {
    label: 'Fast from the start',
    say: 'No slow phase at all — the bed never built resistance. Coarse grind, low dose, or '
      + 'a channel that was open from the first second.',
    confidence: 'practice',
    sources: [],
  },
  stallThenGush: {
    label: 'Nothing, then everything',
    say: 'Held, then broke. Classic for coffee that is still gassy, and for a grind with '
      + 'both fines and boulders in it.',
    confidence: 'practice',
    sources: [],
  },
  trickle: {
    label: 'Never got going',
    say: 'Low flow throughout. Too fine, or too much in the basket.',
    confidence: 'established',
    sources: [],
  },
};

/* --------------------------------------------------------- reference ranges */

/**
 * Starting points, not targets. Every one of these moves with basket, grinder,
 * water and puck prep, and the app says so wherever it shows them.
 */
export const ROAST = {
  light: { temp: [94, 96], ratio: [2.5, 3], ey: [20, 24], rest: [10, 21],
    note: 'Denser and less soluble. Needs more total extraction — but finer grind is only '
      + 'one of four routes to that and the one most likely to backfire. Heat, ratio and '
      + 'higher flow at lower pressure all carry less channelling risk.' },
  medium: { temp: [92, 94], ratio: [2, 2.5], ey: [19, 22], rest: [7, 14], note: '' },
  dark: { temp: [89, 92], ratio: [1.5, 2], ey: [17, 20], rest: [3, 10],
    note: 'Porous and fragile, so it shatters into more fines at the same setting — coarsen '
      + 'more than feels right. Some of its bitterness is the roast and no brewing change '
      + 'removes it.' },
};

/**
 * What each drink structurally IS, which is the part the conventional yield
 * band gets wrong. A ristretto at 15% yield is not an under-extracted espresso;
 * it is a correctly made ristretto, and the app must not flag it.
 */
export const STYLE_BANDS = {
  ristretto: { ratio: [1, 1.5], ey: [13, 17], tds: [11, 15] },
  espresso: { ratio: [1.8, 2.2], ey: [18, 21], tds: [8, 11] },
  long: { ratio: [2.5, 3], ey: [20, 23], tds: [6.5, 8.5] },
  lungo: { ratio: [3, 4], ey: [21, 25], tds: [5, 7] },
};

/** Through-puck flow for a conventional shot. Supply-side numbers are 5x this
 *  and get quoted interchangeably; they are not the same measurement. */
export const FLOW_BAND = [1.2, 2.5];

/* ------------------------------------------------------- the grind conversion */

/**
 * Turn "I want this many seconds faster" into a grind move.
 *
 * Flow through a packed bed is Darcy's law and permeability goes as the square
 * of particle size (Kozeny-Carman), so at fixed dose, basket and pressure the
 * shot time goes as 1/d^2. Differentiating:
 *
 *     dt/t = -2 dd/d      =>      dd = -(d/2)(dt/t)
 *
 * Which gives the rule of thumb worth carrying: about 4 microns per second on a
 * 30 s shot at a 250 micron grind, and one per cent coarser is about two per
 * cent faster.
 *
 * TWO HONEST LIMITS, both of which make this an underestimate:
 *
 *  - It assumes porosity is constant. Going finer also raises the share of
 *    fines, which collapses permeability on its own, so the real exponent is
 *    somewhere above 2. Reality runs roughly 1.5 to 2 times this on grinders
 *    where it has been checked.
 *  - It assumes flow stays homogeneous, which is exactly what fails at the fine
 *    end. Past the extraction peak, finer makes shots slower AND less extracted
 *    AND less repeatable, and no amount of this arithmetic will say so.
 *
 * Returns microns, negative for finer. `steps` only if a step size is known —
 * and for a conical grinder there is no honest single step size at all, because
 * the cutting surfaces sit at an angle to the axis so the gap change per turn
 * varies as you move along the cone.
 */
export function grindMove({ nowSeconds, wantSeconds, micronsNow = 250, micronsPerStep = null }) {
  if (!Number.isFinite(nowSeconds) || !Number.isFinite(wantSeconds) || nowSeconds <= 0) return null;
  const frac = (wantSeconds - nowSeconds) / nowSeconds;
  const microns = -(micronsNow / 2) * frac;
  const out = {
    microns: +microns.toFixed(1),
    direction: microns > 0 ? 'coarser' : 'finer',
    // Stated because the model is known to under-predict, and a user who moves
    // by the low number and sees a bigger change should not conclude the tool
    // is broken.
    atLeast: +(Math.abs(microns)).toFixed(1),
    upTo: +(Math.abs(microns) * 2).toFixed(1),
  };
  if (Number.isFinite(micronsPerStep) && micronsPerStep > 0) {
    out.steps = +(Math.abs(microns) / micronsPerStep).toFixed(1);
  }
  return out;
}

/**
 * Published or mechanically derived step sizes, in microns.
 *
 * `derived` means it came from a manufacturer's thread pitch and division count
 * rather than from anyone measuring grounds. `conical: true` means a single
 * number is geometrically wrong however it was obtained, and the app should
 * only ever use it as an order of magnitude.
 *
 * There is no controlled study anywhere measuring shot-time change per step on
 * any grinder. Everything here is a mechanical spec or a careful inference from
 * one; the seconds all come from the model above, not from a stopwatch.
 */
export const GRINDER_STEPS = {
  '1zpresso-j-ultra': { microns: 8, source: 'maker' },
  '1zpresso-jx-pro': { microns: 12.5, source: 'maker' },
  '1zpresso-jx': { microns: 25, source: 'maker' },
  '1zpresso-k-plus': { microns: 22, source: 'derived' },
  'comandante-c40': { microns: 30, source: 'maker',
    note: 'Reported in practice at 10 to 15 s per click, well above the model’s 7 — which '
      + 'is the clearest illustration that the square law under-predicts.' },
  'comandante-c40-red-clix': { microns: 15, source: 'maker' },
  'df64': { microns: 13.9, source: 'derived',
    note: '1.25 mm thread pitch over about 90 divisions. The maker says 10; the arithmetic '
      + 'says 13.9.' },
  'eureka-mignon': { microns: 24, source: 'derived',
    note: '2400 microns per revolution over 100 marks. Not linear — a plateau in the worm '
      + 'gear makes some of the espresso range much finer per mark.' },
  'lagom-p64': { microns: 10, source: 'maker' },
  'baratza-sette-270': { microns: 24, source: 'derived',
    note: '(950-230)/30 macro steps. Blogs quoting 50 to 75 contradict the grinder’s own '
      + 'stated range.' },
  'niche-zero': { microns: 60, source: 'inferred', conical: true,
    note: 'Back-solved from the widely reported "a third of a mark is about 5 s". No maker '
      + 'figure exists, and for a conical no single figure can be right.' },
};

/* ------------------------------------------------------------------ refuted */

/**
 * Things the app must not say, and why.
 *
 * The first two are corrections to this app's own previous behaviour, which is
 * the reason this file exists rather than a list of other people's errors.
 *
 * The rest are claims that circulate widely and confidently. Several cite
 * studies that do not appear to exist — three separate research passes went
 * looking and could not find them. Knowing which authoritative-sounding numbers
 * to refuse is as useful to a tool like this as knowing which to trust.
 */
export const REFUTED = [
  { claim: 'Flow rising late in a shot means a channel.',
    truth: 'Falling puck resistance makes flow climb at constant pressure. This app said it '
      + 'anyway, at high severity, and it was wrong on ordinary shots.',
    sources: ['decentCurves'] },
  { claim: 'A yield below 17% is under-extracted.',
    truth: 'A ristretto sits at 13 to 17% by construction. This app flagged every correctly '
      + 'made one.',
    sources: ['bhChart'] },
  { claim: '18 to 22% extraction is the scientifically correct window for espresso.',
    truth: 'Inherited from 1950s drip research; the SCA’s own funded successor work '
      + 'replaced the single-box model.',
    sources: ['cotter2021', 'guinard2023'] },
  { claim: 'A shot should take 25 to 30 seconds.',
    truth: 'From seven-gram Italian practice, and it does not even specify what starts the '
      + 'clock. Time is an output, not a setting.',
    sources: ['cameron2020'] },
  { claim: 'Sour means grind finer.',
    truth: 'Only on the coarse side of the extraction peak. Past it, finer makes everything '
      + 'worse at once.',
    sources: ['cameron2020'] },
  { claim: 'Sour and bitter together means you are somewhere in between.',
    truth: 'It means both ends at once. The highest-value correction in the whole subject.',
    sources: ['cameron2020'] },
  { claim: 'A ristretto is more extracted because it is stronger.',
    truth: 'Strength is not extraction. A ristretto is high strength and low yield.',
    sources: ['bhChart'] },
  { claim: 'Thick crema means a good shot.',
    truth: 'It tracks CO2 and roast level. Robusta makes plenty regardless of skill.',
    sources: [] },
  { claim: 'One grind click is about 3 to 7 seconds.',
    truth: 'Meaningless without naming the grinder; it varies by more than an order of '
      + 'magnitude between them.',
    sources: [] },
  { claim: 'A steady 1.8 g/s maximises emulsification of oils and gases.',
    truth: 'No mechanism, no citation, and chemically incoherent as stated. Content-farm '
      + 'invention.',
    sources: [] },
  { claim: 'Fast flow extracts bright acids; slow flow pulls out sugars.',
    truth: 'Same source family as the last one. Invented.',
    sources: [] },
  { claim: 'SCA research shows pressure profiling raises perceived sweetness by 15 to 25%.',
    truth: 'No such SCA publication exists. Invented.',
    sources: [] },
  { claim: 'Faulkner (2020) found stirring the grounds raises yield by 1 to 2 points.',
    truth: 'No such paper — no journal, no institution, no DOI. The real finding for deep '
      + 'stirring is about consistency, which is a different and weaker claim.',
    sources: ['gagnePuck'] },
  { claim: 'Conical burrs make 15 to 20% more fines than flat ones.',
    truth: 'Circulates without a source, and slides between two different definitions of '
      + '"fines" on the way.',
    sources: ['gagnePsd'] },
  { claim: 'A light roast needs one or two microns finer than a dark one.',
    truth: 'Below the resolution of every grinder made. The real difference is tens of '
      + 'microns.',
    sources: [] },
  { claim: 'Fresher coffee is always better.',
    truth: 'False for espresso specifically. Gas in a pressurised bed disrupts it.',
    sources: [] },
];

/** Look a claim up, or die loudly. Nothing may be said that is not in here. */
export function claim(id) {
  const c = CLAIMS[id];
  if (!c) throw new Error(`no such claim: ${id}`);
  return c;
}

/** The hedge a confidence class earns. `established` earns none. */
export function hedge(confidence) {
  return { established: '', practice: 'usually', contested: 'some disagreement here' }[confidence] ?? '';
}
