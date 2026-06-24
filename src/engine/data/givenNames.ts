/**
 * Vendored GIVEN-NAME corpus (E38 / product ruling #1, 2026-06-10): NPC names must read as
 * REAL names. This list is raw material only — seeded sampling draws from it per season; no
 * full-name+persona pairing is hard-coded anywhere (the amended 0004 do-not: "no fixed cast").
 *
 * Composition: 300+ given names, mixed gender and origin, weighted toward the show's 20–40
 * casting demographic (the 1985–2005 birth cohort). Only the 3 DISTINCTIVE Bible sample names
 * (Ryne, Marcus, Felix) are banned by the replayability BDD's deny-list; other common names that
 * also appeared in v0 (e.g. Camila, Elena) are NOT individually banned — common-name recurrence is
 * intentional (real names repeat) and is separately bounded across seasons by the cross-season
 * used-name memory (NAME-1, #547). Single-token `[A-Z][a-z]+` forms only (keeps the 0004 shape).
 */
export const GIVEN_NAMES: readonly string[] = [
  // — A —
  "Aaliyah", "Aaron", "Abby", "Abel", "Ada", "Adam", "Adrian", "Adriana", "Aisha", "Alana",
  "Alejandro", "Alex", "Alexa", "Alicia", "Alina", "Alisha", "Allison", "Alondra", "Amara", "Amber",
  "Amelia", "Amir", "Amy", "Ana", "Andre", "Andrea", "Andres", "Angela", "Angelo", "Anika",
  "Anthony", "Antonia", "April", "Ariana", "Ariel", "Arjun", "Asher", "Ashley", "Ashton", "Aubrey",
  "Audrey", "Austin", "Autumn", "Ava", "Avery", "Axel", "Ayana",
  // — B —
  "Bailey", "Beatriz", "Becca", "Ben", "Bianca", "Blair", "Blake", "Brandon", "Brenda", "Brendan",
  "Brett", "Bria", "Brian", "Briana", "Bridget", "Brock", "Brody", "Brooke", "Bryce", "Brynn",
  // — C —
  "Caleb", "Cameron", "Camila", "Cara", "Carla", "Carlos", "Carmen", "Carson", "Carter", "Casey",
  "Cassandra", "Cassidy", "Celeste", "Cesar", "Chad", "Chandler", "Charlie", "Chase", "Chelsea", "Chloe",
  "Chris", "Christina", "Ciara", "Claire", "Clara", "Clay", "Cody", "Cole", "Colin", "Connor",
  "Cora", "Corey", "Courtney", "Cruz", "Crystal", "Cynthia",
  // — D —
  "Dakota", "Dalia", "Dallas", "Damian", "Dana", "Daniel", "Daniela", "Danny", "Dante", "Daphne",
  "Darius", "Darren", "Dawn", "Dean", "Deja", "Delia", "Demi", "Denise", "Denver", "Derek",
  "Desiree", "Devin", "Devon", "Diana", "Diego", "Dillon", "Dominic", "Dominique", "Donovan", "Drew",
  "Dustin", "Dylan",
  // — E —
  "Easton", "Eddie", "Eden", "Elena", "Eli", "Eliana", "Elias", "Elise", "Ella", "Elliot",
  "Emerson", "Emilia", "Emilio", "Emily", "Emma", "Enzo", "Eric", "Erica", "Erin", "Esme",
  "Esteban", "Ethan", "Eva", "Evan", "Evelyn", "Ezra",
  // — F —
  "Fabian", "Faith", "Farrah", "Fernanda", "Fernando", "Finn", "Fiona", "Francesca", "Frankie", "Freya",
  // — G —
  "Gabe", "Gabriela", "Gage", "Garrett", "Gavin", "Gemma", "Gianna", "Gina", "Giovanni", "Grace",
  "Grant", "Greta", "Griffin", "Gwen",
  // — H —
  "Hailey", "Haley", "Hannah", "Harlow", "Harper", "Harrison", "Hassan", "Hayden", "Hazel", "Heather",
  "Hector", "Holly", "Hope", "Hudson", "Hugo", "Hunter",
  // — I —
  "Ian", "Iliana", "Imani", "India", "Ingrid", "Irene", "Iris", "Isaac", "Isabel", "Isaiah",
  "Isla", "Ivan", "Ivy",
  // — J —
  "Jace", "Jack", "Jackie", "Jada", "Jade", "Jaden", "Jake", "Jalen", "Jamal", "James",
  "Jamie", "Janelle", "Jared", "Jasmine", "Jason", "Javier", "Jaxon", "Jenna", "Jeremy", "Jessica",
  "Jesus", "Jett", "Jillian", "Joanna", "Jocelyn", "Joel", "Joey", "Jordan", "Jorge", "Joseph",
  "Josie", "Juan", "Julia", "Julian", "Juliana", "Julie", "Justin",
  // — K —
  "Kai", "Kaitlyn", "Kara", "Karen", "Karina", "Karl", "Kate", "Katie", "Kayla", "Keisha",
  "Keith", "Kellan", "Kelly", "Kendall", "Kendra", "Kenji", "Kevin", "Kiara", "Kiera", "Kim",
  "Kira", "Kobe", "Kris", "Krista", "Kyle", "Kylie",
  // — L —
  "Lacey", "Lance", "Landon", "Lara", "Laura", "Lauren", "Layla", "Leah", "Leila", "Lena",
  "Leo", "Leon", "Lesly", "Levi", "Lexi", "Liam", "Lila", "Lily", "Lina", "Lisa",
  "Logan", "Lola", "London", "Lorenzo", "Luca", "Lucas", "Lucia", "Luis", "Luke", "Luna",
  "Lydia",
  // — M —
  "Maddox", "Madison", "Maeve", "Maggie", "Malia", "Malik", "Mara", "Marcel", "Margo", "Maria",
  "Mariana", "Mario", "Marisol", "Mark", "Marlon", "Martin", "Mason", "Mateo", "Matt", "Maxine",
  "Maya", "Megan", "Melanie", "Melissa", "Mia", "Micah", "Michael", "Michelle", "Miguel", "Mika",
  "Mila", "Miles", "Mina", "Miranda", "Mitchell", "Molly", "Monica", "Morgan", "Myra",
  // — N —
  "Nadia", "Naomi", "Natalia", "Natalie", "Natasha", "Nathan", "Naya", "Nia", "Nicholas", "Nicole",
  "Nikhil", "Nina", "Noah", "Noel", "Nolan", "Nora", "Nova",
  // — O —
  "Octavia", "Olive", "Oliver", "Olivia", "Omar", "Oscar", "Owen",
  // — P —
  "Paige", "Paloma", "Pablo", "Parker", "Patricia", "Paul", "Paulina", "Penny", "Peter", "Peyton",
  "Phoebe", "Phoenix", "Priya",
  // — Q —
  "Quentin", "Quinn",
  // — R —
  "Rachel", "Rafael", "Raina", "Ramon", "Randy", "Raven", "Ray", "Reagan", "Rebecca", "Reese",
  "Regina", "Remy", "Renee", "Ricardo", "Riley", "Rivka", "Robert", "Rocco", "Roman", "Rosa",
  "Rosie", "Rowan", "Ruby", "Russell", "Ryan",
  // — S —
  "Sabrina", "Sadie", "Sage", "Salma", "Sam", "Samara", "Samir", "Sandra", "Santiago", "Sara",
  "Sasha", "Savannah", "Scott", "Sean", "Selena", "Serena", "Seth", "Shane", "Shawn", "Shelby",
  "Sienna", "Sierra", "Simone", "Skylar", "Sofia", "Sonia", "Sophie", "Spencer", "Stella", "Stephanie",
  "Steven", "Summer", "Sydney",
  // — T —
  "Talia", "Tamara", "Tanner", "Tara", "Tasha", "Tatiana", "Taylor", "Teagan", "Teresa", "Tessa",
  "Theo", "Thomas", "Tiana", "Tiffany", "Tobias", "Tony", "Travis", "Trent", "Trevor", "Trey",
  "Trinity", "Tristan", "Troy", "Tyler",
  // — U / V —
  "Uma", "Valentina", "Valerie", "Vanessa", "Vera", "Veronica", "Victor", "Victoria", "Vincent", "Violet",
  "Vivian",
  // — W / X / Y / Z —
  "Wade", "Walker", "Wendy", "Wesley", "Weston", "Whitney", "Willa", "William", "Willow", "Wyatt",
  "Xavier", "Ximena", "Yara", "Yasmin", "Yolanda", "Yusuf", "Zachary", "Zara", "Zane", "Zion",
  "Zoe",
];
