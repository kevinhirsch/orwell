/**
 * Vendored VOCATION corpus (L28, 2026-06-19): the producer-filtered crew of a real Big Brother
 * cast is a DIVERSE one — never a house full of the same job, and never a cast that mirrors the
 * player's own vocation. This list is the raw material the `CharacterFactory` samples (seeded,
 * capped) so each NPC carries a CONCRETE, PERSISTED occupation the narrator voices instead of
 * inventing (and re-inventing, drifting, or echoing the player's profile).
 *
 * Composition: 120+ occupations spread across sectors a real reality-TV casting team reaches for —
 * trades & labor, healthcare, service & hospitality, sales & business, tech & engineering, the arts,
 * education, public service, the outdoors, sport & fitness, and a few only-on-a-reality-show
 * curios. NO vocation reads as a stat or a hidden attribute (guarded by test). Short noun phrases;
 * raw material only — which job lands on which archetype is the seed's draw, never a fixed pairing
 * (the "no fixed cast" do-not).
 */
export const VOCATIONS: readonly string[] = [
  // — trades, labor & hands-on —
  "electrician", "plumber", "welder", "carpenter", "auto mechanic", "HVAC technician",
  "construction foreman", "landscaper", "house painter", "diesel mechanic", "machinist",
  "roofer", "locksmith",
  // — healthcare —
  "ER nurse", "paramedic", "dental hygienist", "physical therapist", "pharmacist",
  "radiologic technologist", "veterinary technician", "phlebotomist", "occupational therapist",
  "home health aide", "optometrist",
  // — service & hospitality —
  "bartender", "barista", "line cook", "pastry chef", "sommelier", "hotel concierge",
  "flight attendant", "cruise-ship entertainer", "wedding planner", "food-truck owner",
  "tattoo artist", "barber", "hairstylist", "nail technician", "massage therapist",
  // — sales, business & finance —
  "real-estate agent", "car salesperson", "insurance adjuster", "mortgage broker",
  "financial advisor", "supply-chain analyst", "account executive", "small-business owner",
  "pharmaceutical rep", "bank teller", "recruiter", "boutique owner",
  // — tech & engineering —
  "software engineer", "IT support specialist", "data analyst", "QA tester",
  "civil engineer", "aerospace technician", "robotics hobbyist", "drone operator",
  "video-game streamer", "UX designer", "network administrator",
  // — arts, media & creative —
  "graphic designer", "freelance photographer", "podcast host", "session musician",
  "indie filmmaker", "stand-up comedian", "ballet dancer", "novelist", "muralist",
  "voice-over artist", "fashion buyer", "art-gallery assistant", "DJ",
  // — education & academia —
  "high-school teacher", "preschool teacher", "college admissions counselor",
  "grad student", "math tutor", "special-education aide", "museum docent", "librarian",
  // — public service & law —
  "firefighter", "police dispatcher", "paralegal", "social worker", "postal carrier",
  "city planner", "court reporter", "park ranger", "EMT supervisor", "customs officer",
  // — outdoors, agriculture & the road —
  "commercial fisherman", "cattle rancher", "vineyard worker", "beekeeper", "florist",
  "long-haul trucker", "wildland firefighter", "ski-resort guide", "marine biologist",
  "organic farmer", "zookeeper",
  // — sport, fitness & wellness —
  "personal trainer", "yoga instructor", "CrossFit coach", "former college athlete",
  "rock-climbing instructor", "swim coach", "boxing trainer", "surf instructor",
  "spin-class instructor", "physical-education teacher",
  // — the only-on-a-reality-show curios —
  "competitive-eating champ", "professional cuddler", "escape-room designer",
  "renaissance-fair performer", "mascot performer", "cheese monger", "axe-throwing coach",
  "ghost-tour guide", "balloon artist", "professional poker player",
];
