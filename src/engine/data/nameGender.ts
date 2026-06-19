/**
 * Name → typical gender presentation lexicon (feature 0063).
 *
 * The gender-balance floor must read each NPC's gender presentation, and the cast's NAMES are drawn on
 * the byte-stable MAIN house stream (changing that stream would re-baseline the seeded season and break
 * the calibration gates). So gender presentation is DERIVED from the already-drawn given name via this
 * static lexicon, never by re-sampling names. The lexicon classifies each corpus given name as:
 *   • "man"    — reads as a men's name
 *   • "woman"  — reads as a women's name
 *   • "unisex" — genuinely ambiguous (Alex, Jordan, Taylor, Riley…) — the houseguest may present any way
 *
 * This keeps a houseguest's NAME and PRESENTATION coherent (a "James" presents as a man) while the
 * balance-floor repair (feature 0063) only ever re-targets UNISEX names, so a repaired cast never reads
 * as "a woman's name on a man" — coherence holds. Nonbinary presentation is likewise assigned only to
 * unisex names. Plain data, no stat vocabulary — never crosses the Vault in any leak-scannable form.
 *
 * Determinism: this is a fixed lookup, so the derived presentation is seed-stable + player-independent.
 * A name not in the lexicon falls back to "unisex" (treated as fully flexible) — safe by construction.
 */

export type NameGender = "man" | "woman" | "unisex";

const MEN: readonly string[] = [
  "Aaron", "Abel", "Adam", "Adrian", "Alejandro", "Amir", "Andre", "Andres", "Angelo", "Anthony",
  "Arjun", "Asher", "Ashton", "Austin", "Axel", "Ben", "Brandon", "Brendan", "Brett", "Brian",
  "Brock", "Brody", "Bryce", "Caleb", "Carlos", "Carson", "Carter", "Cesar", "Chad", "Chandler",
  "Chase", "Cody", "Cole", "Colin", "Connor", "Cruz", "Damian", "Daniel", "Danny", "Dante",
  "Darius", "Darren", "Dean", "Derek", "Diego", "Dillon", "Dominic", "Dustin", "Easton", "Eddie",
  "Eli", "Elias", "Emilio", "Enzo", "Eric", "Esteban", "Ethan", "Evan", "Ezra", "Fabian",
  "Fernando", "Finn", "Gabe", "Gage", "Garrett", "Gavin", "Giovanni", "Grant", "Griffin", "Harrison",
  "Hassan", "Hector", "Hudson", "Hugo", "Ian", "Isaac", "Isaiah", "Ivan", "Jace", "Jack",
  "Jaden", "Jake", "Jalen", "Jamal", "James", "Jared", "Jason", "Javier", "Jaxon", "Jeremy",
  "Jesus", "Jett", "Joel", "Joey", "Jorge", "Joseph", "Juan", "Julian", "Justin", "Karl",
  "Keith", "Kellan", "Kenji", "Kevin", "Kobe", "Kyle", "Lance", "Landon", "Leo", "Leon",
  "Levi", "Liam", "Lorenzo", "Luca", "Lucas", "Luis", "Luke", "Maddox", "Malik", "Marcel",
  "Mario", "Mark", "Marlon", "Martin", "Mason", "Mateo", "Matt", "Micah", "Michael", "Miguel",
  "Miles", "Mitchell", "Nathan", "Nicholas", "Nikhil", "Noah", "Nolan", "Oliver", "Omar", "Oscar",
  "Owen", "Pablo", "Paul", "Peter", "Quentin", "Rafael", "Ramon", "Randy", "Ray", "Ricardo",
  "Robert", "Rocco", "Roman", "Russell", "Ryan", "Samir", "Santiago", "Scott", "Sean", "Seth",
  "Shane", "Shawn", "Spencer", "Steven", "Tanner", "Theo", "Thomas", "Tobias", "Tony", "Travis",
  "Trent", "Trevor", "Trey", "Tristan", "Troy", "Tyler", "Victor", "Vincent", "Wade", "Walker",
  "Wesley", "Weston", "William", "Wyatt", "Xavier", "Yusuf", "Zachary", "Zane", "Zion",
];

const WOMEN: readonly string[] = [
  "Aaliyah", "Abby", "Ada", "Adriana", "Aisha", "Alana", "Alexa", "Alicia", "Alina", "Alisha",
  "Allison", "Alondra", "Amara", "Amber", "Amelia", "Amy", "Ana", "Andrea", "Angela", "Anika",
  "Antonia", "April", "Ariana", "Aubrey", "Audrey", "Autumn", "Ava", "Ayana", "Beatriz", "Becca",
  "Bianca", "Brenda", "Bria", "Briana", "Bridget", "Brooke", "Brynn", "Camila", "Cara", "Carla",
  "Carmen", "Cassandra", "Celeste", "Chelsea", "Chloe", "Christina", "Ciara", "Claire", "Clara", "Cora",
  "Courtney", "Crystal", "Cynthia", "Dalia", "Daniela", "Daphne", "Dawn", "Deja", "Delia", "Demi",
  "Denise", "Desiree", "Diana", "Elena", "Eliana", "Elise", "Ella", "Emilia", "Emily", "Emma",
  "Erica", "Erin", "Esme", "Eva", "Evelyn", "Faith", "Farrah", "Fernanda", "Fiona", "Francesca",
  "Freya", "Gabriela", "Gemma", "Gianna", "Gina", "Grace", "Greta", "Gwen", "Hailey", "Haley",
  "Hannah", "Hazel", "Heather", "Holly", "Hope", "Iliana", "Imani", "Ingrid", "Irene", "Iris",
  "Isabel", "Isla", "Ivy", "Jackie", "Jada", "Jade", "Janelle", "Jasmine", "Jenna", "Jessica",
  "Jillian", "Joanna", "Jocelyn", "Josie", "Julia", "Juliana", "Julie", "Kaitlyn", "Kara", "Karen",
  "Karina", "Kate", "Katie", "Kayla", "Keisha", "Kelly", "Kendra", "Kiara", "Kiera", "Kira",
  "Krista", "Kylie", "Lacey", "Lara", "Laura", "Lauren", "Layla", "Leah", "Leila", "Lena",
  "Lesly", "Lexi", "Lila", "Lily", "Lina", "Lisa", "Lola", "Lucia", "Luna", "Lydia",
  "Madison", "Maeve", "Maggie", "Malia", "Mara", "Margo", "Maria", "Mariana", "Marisol", "Maxine",
  "Maya", "Megan", "Melanie", "Melissa", "Mia", "Michelle", "Mika", "Mila", "Mina", "Miranda",
  "Molly", "Monica", "Myra", "Nadia", "Naomi", "Natalia", "Natalie", "Natasha", "Naya", "Nia",
  "Nicole", "Nina", "Nora", "Octavia", "Olive", "Olivia", "Paige", "Paloma", "Patricia", "Paulina",
  "Penny", "Phoebe", "Priya", "Rachel", "Raina", "Rebecca", "Regina", "Renee", "Rosa", "Rosie",
  "Ruby", "Sabrina", "Sadie", "Salma", "Samara", "Sandra", "Sara", "Sasha", "Savannah", "Selena",
  "Serena", "Shelby", "Sienna", "Sierra", "Simone", "Sofia", "Sonia", "Sophie", "Stella", "Stephanie",
  "Summer", "Talia", "Tamara", "Tara", "Tasha", "Tatiana", "Teresa", "Tessa", "Tiana", "Tiffany",
  "Trinity", "Uma", "Valentina", "Valerie", "Vanessa", "Vera", "Veronica", "Victoria", "Violet", "Vivian",
  "Wendy", "Whitney", "Willa", "Willow", "Ximena", "Yara", "Yasmin", "Yolanda", "Zara", "Zoe",
];

/**
 * Genuinely ambiguous given names — the houseguest may present as a man, a woman, or nonbinary, and the
 * name stays coherent either way. The balance-floor repair and the nonbinary assignment target ONLY
 * these, so a repaired cast never lands a clearly-gendered name on the "wrong" presentation.
 */
const UNISEX: readonly string[] = [
  "Adrian", "Alex", "Ariel", "Avery", "Bailey", "Blair", "Blake", "Cameron", "Casey", "Cassidy",
  "Charlie", "Chris", "Dakota", "Dallas", "Dana", "Denver", "Devin", "Devon", "Dominique", "Drew",
  "Eden", "Elliot", "Emerson", "Frankie", "Harlow", "Harper", "Hayden", "Hunter", "India", "Jamie",
  "Jordan", "Kai", "Kendall", "Kim", "Kris", "Lennon", "London", "Logan", "Marlon", "Morgan",
  "Noel", "Nova", "Parker", "Peyton", "Phoenix", "Quinn", "Raven", "Reagan", "Reese", "Remy",
  "Riley", "Rowan", "Sage", "Sam", "Shawn", "Skylar", "Sydney", "Tatum", "Taylor", "Teagan",
];

const MEN_SET = new Set(MEN);
const WOMEN_SET = new Set(WOMEN);
const UNISEX_SET = new Set(UNISEX);

/**
 * The typical gender of a given name (the FIRST token of a display name). Unisex names — and any name not
 * in the lexicon — return "unisex" (fully flexible), so the result is safe by construction. A name in BOTH
 * the unisex set and a gendered set resolves to "unisex" (unisex wins — it is the more flexible read).
 */
export function nameGenderOf(givenName: string): NameGender {
  const g = givenName.split(" ")[0] ?? givenName;
  if (UNISEX_SET.has(g)) return "unisex";
  if (MEN_SET.has(g)) return "man";
  if (WOMEN_SET.has(g)) return "woman";
  return "unisex";
}
