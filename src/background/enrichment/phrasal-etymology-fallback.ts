/**
 * Compositional phrasal-verb etymology fallback.
 *
 * Wiktionary's REST API lacks a dedicated Etymology section for many
 * compositional phrasal verbs ("look up", "give up", "turn on", etc.)
 * because the meaning is derived from the head verb plus the particle.
 * Our `wiktionaryHtml` source attempts a runtime fallback fetch of the
 * head verb's etymology, but Wiktionary occasionally serves an empty
 * body on cold cache hits — re-introducing jitter into the popover.
 *
 * To eliminate that jitter, we bundle a pre-curated map of base-verb
 * etymologies for the 50 most common English head verbs that combine
 * into phrasal verbs. The map is consulted as a deterministic last
 * resort whenever Wiktionary returns nothing — keeping etymology
 * coverage at ~100% across the test corpus without ANY second network
 * call.
 *
 * Source: Wiktionary etymology paragraphs (CC-BY-SA), distilled to a
 * single sentence per verb.
 */

const PARTICLES = new Set([
  'up', 'down', 'on', 'off', 'in', 'out', 'over', 'under',
  'away', 'back', 'through', 'around', 'about',
]);

const BASE_VERB_ETYMOLOGY: Record<string, string> = {
  give: 'From Middle English given, from Old English giefan and Old Norse gefa, from Proto-Germanic *gebaną.',
  look: 'From Middle English loken, from Old English lōcian, from Proto-West Germanic *lōkōn.',
  turn: 'From Middle English turnen, from Old English turnian/tyrnan, from Proto-West Germanic *turnēn (to turn, lathe).',
  take: 'From Middle English taken, from Old English tacan, from Old Norse taka, from Proto-Germanic *tēkaną (to grasp, take).',
  put: 'From Middle English putten, from Old English putian (to push, thrust), of obscure origin.',
  get: 'From Middle English geten, from Old Norse geta, from Proto-Germanic *getaną (to get, to obtain).',
  go: 'From Middle English gon, from Old English gān, from Proto-West Germanic *gān, from Proto-Germanic *gāną (to go).',
  come: 'From Middle English comen, from Old English cuman, from Proto-Germanic *kwemaną (to come).',
  bring: 'From Middle English bringen, from Old English bringan, from Proto-West Germanic *bringan.',
  set: 'From Middle English setten, from Old English settan, from Proto-Germanic *satjaną (to set, place).',
  break: 'From Middle English breken, from Old English brecan, from Proto-Germanic *brekaną (to break).',
  call: 'From Middle English callen, from Old Norse kalla, from Proto-Germanic *kallōną (to call).',
  carry: 'From Anglo-Norman carier, from Old French carier, from Late Latin carricāre, from Latin carrus (wagon).',
  catch: 'From Middle English cacchen, from Anglo-Norman cachier, from Vulgar Latin *captiāre, from Latin captāre.',
  cut: 'From Middle English cutten, kytten, of obscure origin, possibly from Old Norse *kytja.',
  fall: 'From Middle English fallen, from Old English feallan, from Proto-West Germanic *fallan, from Proto-Germanic *fallaną (to fall).',
  hand: 'From Middle English hand, hond, from Old English hand, from Proto-Germanic *handuz (hand).',
  hold: 'From Middle English holden, from Old English healdan, from Proto-Germanic *haldaną (to tend, watch).',
  keep: 'From Middle English kepen, from Old English cēpan (to seize, observe), of uncertain origin.',
  let: 'From Middle English leten, from Old English lǣtan, from Proto-Germanic *lētaną (to allow, leave).',
  make: 'From Middle English maken, from Old English macian, from Proto-West Germanic *makōn (to make, build).',
  pick: 'From Middle English picken, pikken, of uncertain origin (possibly Old English *piccian or borrowed).',
  pull: 'From Middle English pullen, from Old English pullian (to pluck, draw, drag), of uncertain Germanic origin.',
  push: 'From Middle English pusshen, from Old French poulser, from Latin pulsāre (to push, beat).',
  run: 'From Middle English runnen, from Old Norse rinna and Old English rinnan, from Proto-Germanic *rinnaną (to run).',
  see: 'From Middle English seen, from Old English sēon, from Proto-Germanic *sehwaną (to see).',
  show: 'From Middle English schewen, from Old English scēawian (to look at, behold), from Proto-Germanic *skawwōną.',
  sit: 'From Middle English sitten, from Old English sittan, from Proto-Germanic *sitjaną (to sit).',
  stand: 'From Middle English standen, from Old English standan, from Proto-Germanic *standaną (to stand).',
  stick: 'From Middle English stikken, from Old English stician (to pierce, stab), from Proto-Germanic *stikōną.',
  talk: 'From Middle English talken, frequentative of tale (to speak), from Old English talu (tale).',
  tell: 'From Middle English tellen, from Old English tellan (to count, recount), from Proto-Germanic *taljaną.',
  think: 'From Middle English thinken, from Old English þencan, from Proto-Germanic *þankijaną (to think).',
  try: 'From Middle English trien, from Old French trier (to pick out, sort), from Late Latin trītāre.',
  walk: 'From Middle English walken, from Old English wealcan (to roll, toss, journey), from Proto-Germanic *walkaną.',
  watch: 'From Middle English wacchen, from Old English wæccan (to be awake, watch), from Proto-Germanic *wakjaną.',
  work: 'From Middle English werken, worken, from Old English wyrcan, from Proto-West Germanic *wurkijan.',
  write: 'From Middle English writen, from Old English wrītan (to incise, draw, write), from Proto-Germanic *wrītaną.',
  drop: 'From Middle English droppen, from Old English droppian, from Proto-Germanic *druppōną (to drop, drip).',
  end: 'From Middle English ende, from Old English ende, from Proto-Germanic *andijaz (end).',
  fill: 'From Middle English fillen, from Old English fyllan, from Proto-Germanic *fullijaną (to fill, make full).',
  find: 'From Middle English finden, from Old English findan, from Proto-Germanic *finþaną (to come upon).',
  fix: 'From Middle English fixen, from Old French fixer, from Latin fīxus (fixed, firm).',
  hang: 'From Middle English hangen, from Old English hangian and Old Norse hanga, from Proto-Germanic *hanhaną.',
  jump: 'Possibly from Middle English jumpen, of imitative origin (akin to bump, thump).',
  pass: 'From Middle English passen, from Old French passer, from Vulgar Latin *passāre, from Latin passus (step).',
  rise: 'From Middle English risen, from Old English rīsan, from Proto-Germanic *rīsaną (to rise).',
  rule: 'From Middle English rule, from Old French riule, from Latin rēgula (rule, pattern).',
  send: 'From Middle English senden, from Old English sendan, from Proto-Germanic *sandijaną (to send).',
  shut: 'From Middle English shutten, schutten, from Old English scyttan (to bar, fasten), of uncertain origin.',
  sign: 'From Middle English signe, from Old French signe, from Latin signum (mark, sign, token).',
  step: 'From Middle English steppen, from Old English steppan, from Proto-Germanic *stapjaną (to tread).',
  switch: 'From Middle English swiche, of obscure origin, possibly from Middle Dutch swijch (twig, rod).',
  throw: 'From Middle English throwen, from Old English þrāwan (to twist, turn), from Proto-Germanic *þrēaną.',
  wake: 'From Middle English waken, from Old English wacan (to be born, arise) and wacian (to be awake).',
  warm: 'From Middle English warmen, from Old English wearmian, from Proto-Germanic *warmijaną (to warm).',
};

/**
 * If `token` is a `verb particle` phrasal whose head verb is in our
 * curated table, returns a compositional etymology paragraph. Returns
 * null otherwise.
 */
export function buildPhrasalEtymologyFallback(token: string): string | null {
  const parts = token.trim().toLowerCase().split(/\s+/);
  if (parts.length !== 2) return null;
  if (!PARTICLES.has(parts[1])) return null;
  const baseEty = BASE_VERB_ETYMOLOGY[parts[0]];
  if (!baseEty) return null;
  const composed = `Compositional phrasal verb formed from "${parts[0]}" + "${parts[1]}". Origin of "${parts[0]}": ${baseEty}`;
  return composed.length > 360 ? composed.slice(0, 357) + '…' : composed;
}
