import { createHash } from 'node:crypto';

/**
 * The invented content and the deterministic generator behind `npm run seed:demo`.
 *
 * Everything here is fictional: Albanian-style publishers, titles and authors that are not
 * real books, people or houses. `buildDemoPlan` is pure: the same seed and the same `now`
 * give the same plan, down to every id and every timestamp. `seed-demo.ts` turns the plan
 * into rows through the real commerce, cover and asset paths.
 */

export const DEMO_SEED = 20261116;
export const DEMO_PASSWORD = 'Password123!';
export const DEMO_READER_COUNT = 40;
/** Sales cover this many days, ending today. */
export const DEMO_WINDOW_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Buyer countries, most common first. Weights add up to 100. */
export const DEMO_COUNTRIES = [
  { code: 'AL', weight: 40 },
  { code: 'XK', weight: 20 },
  { code: 'MK', weight: 9 },
  { code: 'IT', weight: 8 },
  { code: 'DE', weight: 8 },
  { code: 'CH', weight: 6 },
  { code: 'ME', weight: 4 },
  { code: 'GR', weight: 3 },
  { code: 'US', weight: 2 },
] as const;

export type DemoGenre = 'Fiction' | 'Poetry' | 'History' | 'Children' | 'Essays';
export type DemoLanguage = 'sq' | 'en';
/** `rejected` is a draft whose uploaded file was refused by the ingestion pipeline. */
export type DemoBookStatus = 'published' | 'draft' | 'ready' | 'archived' | 'rejected';

export interface DemoPublisher {
  id: string;
  name: string;
  contactEmail: string;
  country: string;
  loginEmail: string;
  loginName: string;
  createdAt: Date;
  /** In force from before the earliest demo sale, so every snapshotted rate matches it. */
  rate: { rateBps: number; effectiveFrom: Date; contractReference: string };
  futureRate: { rateBps: number; effectiveFrom: Date; contractReference: string } | null;
}

export interface DemoBook {
  id: string;
  publisherId: string;
  title: string;
  author: string;
  genre: DemoGenre;
  language: DemoLanguage;
  priceCents: number;
  isbn13: string;
  description: string;
  status: DemoBookStatus;
  chapters: Array<{ title: string; paragraphs: string[] }>;
  withCover: boolean;
  cover: { background: string; accent: string; ink: string };
  createdAt: Date;
  /** Set for published and archived books: the moment they went on sale. */
  publishedAt: Date | null;
  archivedAt: Date | null;
}

export interface DemoReader {
  id: string;
  email: string;
  displayName: string;
  countryCode: string;
  createdAt: Date;
}

export type DemoRefund =
  | { kind: 'full'; at: Date }
  | { kind: 'partial'; at: Date; amountCents: number };

export interface DemoOrder {
  index: number;
  readerId: string;
  bookIds: string[];
  countryCode: string;
  /** When the checkout was started. */
  createdAt: Date;
  paidAt: Date;
  refund: DemoRefund | null;
}

export interface DemoPlan {
  seed: number;
  now: Date;
  windowStart: Date;
  publishers: DemoPublisher[];
  books: DemoBook[];
  readers: DemoReader[];
  orders: DemoOrder[];
}

// ---------------------------------------------------------------------------
// Invented content
// ---------------------------------------------------------------------------

interface PublisherSpec {
  name: string;
  slug: string;
  country: string;
  rateBps: number;
  reference: string;
  futureRateBps?: number;
  bookCount: number;
  /** Position within the publisher's books -> status (everything else is published). */
  statuses: Record<number, DemoBookStatus>;
  /** Draft positions that have no cover yet. */
  noCover: number[];
}

const PUBLISHERS: PublisherSpec[] = [
  {
    name: 'Pema e Kuqe Botime',
    slug: 'pemaekuqebotime',
    country: 'AL',
    rateBps: 2500,
    reference: 'Kontrata PK-2026/01',
    bookCount: 15,
    statuses: { 13: 'ready', 14: 'draft' },
    noCover: [14],
  },
  {
    name: 'Shtëpia Botuese Ura',
    slug: 'shtepiaura',
    country: 'AL',
    rateBps: 2000,
    reference: 'Kontrata UR-2026/02',
    futureRateBps: 1800,
    bookCount: 15,
    statuses: { 13: 'archived', 14: 'draft' },
    noCover: [],
  },
  {
    name: 'Gështenja Botime',
    slug: 'geshtenjabotime',
    country: 'XK',
    rateBps: 3000,
    reference: 'Kontrata GJ-2026/03',
    bookCount: 16,
    statuses: { 13: 'rejected', 14: 'ready', 15: 'draft' },
    noCover: [15],
  },
  {
    name: 'Kodra e Blertë',
    slug: 'kodraeblerte',
    country: 'MK',
    rateBps: 1800,
    reference: 'Kontrata KB-2026/04',
    bookCount: 16,
    statuses: { 14: 'ready', 15: 'draft' },
    noCover: [],
  },
];

interface TitleSpec {
  title: string;
  genre: DemoGenre;
  language: DemoLanguage;
}

const sq = (genre: DemoGenre, titles: string[]): TitleSpec[] =>
  titles.map((title) => ({ title, genre, language: 'sq' }));
const en = (genre: DemoGenre, titles: string[]): TitleSpec[] =>
  titles.map((title) => ({ title, genre, language: 'en' }));

/** 62 invented titles: 56 Albanian and 6 English. */
const TITLES: TitleSpec[] = [
  ...sq('Fiction', [
    'Shtëpia mbi Lumin e Heshtur',
    'Nata kur Retë Ranë',
    'Letra nga Qyteti i Harruar',
    'Pasqyra e Dhjetë Vjetëve',
    'Hijet e Rrugës së Gurtë',
    'Dimri në Kullën e Vjetër',
    'Pesë Dritare nga Deti',
    'Udhëtari pa Hartë',
    'Zonja e Hanit të Bardhë',
    'Era e Marsit',
    'Kambana nën Dhe',
    'Fëmija i Stinës së Katërt',
    'Ura e Kujtimeve të Humbura',
    'Mbrëmje në Hanin e Gurit',
    'Peshkatari dhe Hëna',
    'Dëshmitari i Heshtur',
    'Dera e Nëntë',
    'Zogjtë e Mëngjesit të Vonë',
  ]),
  ...en('Fiction', ['The Quiet Harbour', 'Letters from a Forgotten Town']),
  ...sq('Poetry', [
    'Gjethe të Dimrit',
    'Vargje për Shiun',
    'Zëri i Gurit',
    'Lutje për Mëngjesin',
    'Dallëndyshet e Marsit',
    'Pas Largimit të Detit',
    'Fjalë nën Hënë',
    'Shpirti i Pyllit',
    'Kënga e Pritjes',
  ]),
  ...en('Poetry', ['Seven Windows to the Sea']),
  ...sq('History', [
    'Qytetet e Vjetra të Bregdetit',
    'Rrugët e Karvaneve',
    'Kronikë e Një Shekulli të Heshtur',
    'Kalatë dhe Njerëzit e Tyre',
    'Pazari i Vjetër: Histori e Përditshme',
    'Ditarët e Udhëtarëve',
    'Letrat e Kapedanit',
    'Hartat e Humbura të Ballkanit',
    'Zanatet që Humbën',
    'Nën Hijen e Kalasë',
    'Historia e Një Fshati Malor',
  ]),
  ...en('History', ['Roads of the Old Caravans']),
  ...sq('Children', [
    'Macja që Kërkonte Hënën',
    'Dhelpra e Vogël dhe Shiu',
    'Lulja Magjike e Gjyshes',
    'Gjuha e Zogjve',
    'Shokët e Lumit',
    'Mjeshtri i Balonave',
    'Udhëtimi i Dhisë së Bardhë',
    'Çanta e Mbushur me Yje',
    'Ariu që nuk Flinte',
  ]),
  ...en('Children', ['The Little Fox and the Rain']),
  ...sq('Essays', [
    'Mbi Heshtjen dhe Fjalën',
    'Shënime për një Qytet',
    'Biblioteka e Natës',
    'Pak Kohë për Lexim',
    'Fytyrat e Gjuhës',
    'Letër një Lexuesi të Ri',
    'Ese mbi Kujtesën',
    'Rrugët e Mendimit',
    'Përmbi Çajin e Mëngjesit',
  ]),
  ...en('Essays', ['A Small Room for Reading']),
];

const FIRST_NAMES = [
  'Arta',
  'Besa',
  'Drita',
  'Elira',
  'Flutura',
  'Genta',
  'Hana',
  'Ilira',
  'Jehona',
  'Kaltrina',
  'Liridona',
  'Mimoza',
  'Nora',
  'Orjola',
  'Pranvera',
  'Rozafa',
  'Sara',
  'Teuta',
  'Vjosa',
  'Zana',
  'Arben',
  'Besnik',
  'Dardan',
  'Edon',
  'Flamur',
  'Gent',
  'Hekuran',
  'Ilir',
  'Jetmir',
  'Kushtrim',
  'Leart',
  'Mentor',
  'Nderim',
  'Olti',
  'Petrit',
  'Redon',
  'Shpend',
  'Taulant',
  'Valon',
  'Artan',
];

const LAST_NAMES = [
  'Gjokaj',
  'Prenga',
  'Shkurti',
  'Cani',
  'Rrapaj',
  'Mehmetaj',
  'Ndreca',
  'Selimi',
  'Kryeziu',
  'Lleshi',
  'Bardhi',
  'Cela',
  'Dibra',
  'Elezi',
  'Frroku',
  'Gashi',
  'Hoti',
  'Isufi',
  'Jashari',
  'Kola',
  'Lika',
  'Muça',
  'Nika',
  'Osmani',
  'Pepa',
  'Rexha',
  'Sadiku',
  'Tafa',
  'Ukaj',
  'Vata',
  'Zeqiri',
  'Dedja',
];

const SQ_SENTENCES = [
  'Mëngjesi erdhi ngadalë mbi çatitë e qytetit, dhe rruga u mbush me zërin e parë të kambanës.',
  'Ajo e mbylli derën pas vetes dhe dëgjoi heshtjen që po rritej në shtëpi.',
  'Në fund të rrugës, një plak shiste dardha dhe tregonte histori që askush nuk i kishte kërkuar.',
  'Deti ishte i qetë atë ditë, sikur po priste që dikush të fliste i pari.',
  'Ai hapi letrën dy herë, por fjalët mbetën po aq të largëta sa herën e parë.',
  'Nën dritaren e vogël, një mace e verdhë ndiqte hijen e një zogu që nuk ekzistonte.',
  'Kishte vite që askush nuk kishte ngjitur shkallët e vjetra të kullës.',
  'Era solli nga fusha aromën e barit të sapoprerë dhe zërat e fëmijëve që luanin.',
  'Gjyshja thoshte se çdo libër i mirë ka një derë të fshehtë pas faqes së fundit.',
  'Në pazar, njerëzit kalonin pa nxitim, duke vlerësuar çdo send sikur të ishte kujtim.',
  'Dielli u ul pas kodrës dhe qyteti ndezi dritat një nga një, si një varg i gjatë i durimit.',
  'Ajo e dinte që udhëtimi do të ishte i gjatë, por nuk e kishte frikë distancën.',
  'Mes rafteve të bibliotekës, koha dukej se ecte më ngadalë dhe më me kujdes.',
  'Një çati e kuqe, një portë e hapur dhe një filxhan çaji i ngrohtë: kaq i duhej asaj mbrëmjeje.',
  'Shiu filloi pa zhurmë, pastaj gjithçka u bë pjesë e një kënge të vetme.',
  'Pas shumë vitesh, ai mësoi se heshtja nuk është gjithmonë mungesë fjalësh.',
  'Në majë të kodrës, dy fëmijë ndanin një copë bukë dhe numëronin yjet e parë.',
  'Rruga e vjetër me kalldrëm ruante ende hapat e atyre që e kishin kaluar.',
];

const EN_SENTENCES = [
  'Morning arrived slowly over the rooftops, and the street filled with the first sound of the bell.',
  'She closed the door behind her and listened to the quiet that was growing in the house.',
  'At the end of the road, an old man sold pears and told stories nobody had asked for.',
  'The sea was calm that day, as if it were waiting for someone to speak first.',
  'He opened the letter twice, yet the words stayed as distant as they were the first time.',
  'The wind carried the smell of cut grass from the fields, and the voices of children at play.',
];

const CHAPTER_TITLES_SQ = [
  'Kapitulli i Parë: Fillimi',
  'Kapitulli i Dytë: Rruga',
  'Kapitulli i Tretë: Kthimi',
];
const CHAPTER_TITLES_EN = ['Chapter One: The Beginning', 'Chapter Two: The Road'];

const DESCRIPTIONS: Record<DemoGenre, { sq: string[]; en: string[] }> = {
  Fiction: {
    sq: [
      'Një roman i qetë për njerëz të zakonshëm në një qytet që ndryshon ngadalë.',
      'Një rrëfim për kujtesën, largimin dhe shtëpinë që mbetet brenda nesh.',
      'Disa jetë që kryqëzohen një verë të gjatë, mes sekreteve dhe dashurisë së heshtur.',
    ],
    en: ['A quiet novel about ordinary people in a town that changes slowly.'],
  },
  Poetry: {
    sq: [
      'Një përmbledhje vargjesh për stinët, detin dhe fjalët që nuk thuhen me zë të lartë.',
      'Poezi të shkurtra, të ndritshme dhe të buta, shkruar mes dy mëngjeseve.',
    ],
    en: ['Short, bright poems written between two mornings.'],
  },
  History: {
    sq: [
      'Një libër për njerëzit dhe vendet që formuan rrugën e gjatë të një krahine.',
      'Kronika të përditshmërisë, nga pazari te kalaja, të mbledhura nga dëshmi të vjetra.',
    ],
    en: ['A short history of the people and the roads that shaped a region.'],
  },
  Children: {
    sq: [
      'Një përrallë me figura për fëmijët e vegjël, plot miqësi dhe befasi të buta.',
      'Një aventurë e shkurtër për të lexuar para gjumit, me një fund të ngrohtë.',
    ],
    en: ['A short bedtime story full of friendship and gentle surprises.'],
  },
  Essays: {
    sq: [
      'Ese të shkurtra për leximin, qytetin dhe zakonet e vogla që na bëjnë njerëz.',
      'Shënime e mendime për gjuhën, kujtesën dhe kohën e lirë.',
    ],
    en: ['Short essays on reading, the city and the small habits that make us human.'],
  },
};

const PRICE_LADDER = [
  399, 449, 499, 549, 599, 649, 699, 799, 849, 899, 999, 1099, 1199, 1299, 1399, 1499,
];
const PRICE_RANGE: Record<DemoGenre, [number, number]> = {
  Children: [399, 699],
  Poetry: [449, 899],
  Fiction: [599, 1299],
  Essays: [699, 1199],
  History: [899, 1499],
};

/** Muted editorial tones, in the portal's palette family. */
const COVER_PALETTE = [
  { background: '#263D32', accent: '#C9B88A', ink: '#E6DFCF' },
  { background: '#793E43', accent: '#E3C9A0', ink: '#F1E8DA' },
  { background: '#85847C', accent: '#E6DFCF', ink: '#1C1B17' },
  { background: '#E6DFCF', accent: '#793E43', ink: '#263D32' },
  { background: '#2F3B45', accent: '#B9A57A', ink: '#E6DFCF' },
  { background: '#5B4B3A', accent: '#D8C7A3', ink: '#F0E9DA' },
];

const COVER_LABELS: Record<DemoGenre, { sq: string; en: string }> = {
  Fiction: { sq: 'Prozë', en: 'Fiction' },
  Poetry: { sq: 'Poezi', en: 'Poetry' },
  History: { sq: 'Histori', en: 'History' },
  Children: { sq: 'Për fëmijë', en: 'For children' },
  Essays: { sq: 'Ese', en: 'Essays' },
};

/** The small tag printed above the title on a demo cover. */
export function coverLabel(genre: DemoGenre, language: DemoLanguage): string {
  return COVER_LABELS[genre][language];
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/** Small seeded PRNG (mulberry32): returns numbers in [0, 1). */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fixed UUID per (kind, index): the same on every run, and never a random one. */
export function demoUuid(kind: string, index: number): string {
  const hex = createHash('sha1').update(`libraria-demo/${kind}/${index}`).digest('hex');
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

type Random = () => number;

function pick<T>(random: Random, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)] as T;
}

function shuffle<T>(random: Random, list: readonly T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

function weightedPick<T>(random: Random, items: readonly T[], weight: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  let roll = random() * total;
  for (const item of items) {
    roll -= weight(item);
    if (roll < 0) return item;
  }
  return items[items.length - 1] as T;
}

const pickCountry = (random: Random) => weightedPick(random, DEMO_COUNTRIES, (c) => c.weight).code;

function ascii(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isbn13(index: number): string {
  // Invented demo numbers: 13 digits with a correct check digit, so they pass validation.
  // They are not registered to anything, and may by chance equal a real ISBN: never use them
  // outside the demo.
  const body = `9780000${String(index + 1).padStart(5, '0')}`;
  const sum = [...body].reduce((acc, digit, i) => acc + Number(digit) * (i % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export function buildDemoPlan(seed: number, now: Date = new Date()): DemoPlan {
  const random = rng(seed);
  const today = startOfUtcDay(now);
  const windowStart = new Date(today.getTime() - (DEMO_WINDOW_DAYS - 1) * DAY_MS);
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const publishers: DemoPublisher[] = PUBLISHERS.map((spec, index) => ({
    id: demoUuid('publisher', index + 1),
    name: spec.name,
    contactEmail: `info@${spec.slug}.example`,
    country: spec.country,
    loginEmail: `redaksia@${spec.slug}.example`,
    loginName: `Redaksia ${spec.name}`,
    createdAt: new Date(windowStart.getTime() - 45 * DAY_MS),
    rate: {
      rateBps: spec.rateBps,
      effectiveFrom: new Date(windowStart.getTime() - 30 * DAY_MS),
      contractReference: spec.reference,
    },
    futureRate: spec.futureRateBps
      ? {
          rateBps: spec.futureRateBps,
          effectiveFrom: nextMonth,
          contractReference: `${spec.reference}, shtojca`,
        }
      : null,
  }));

  // --- Books -------------------------------------------------------------
  const titles = shuffle(random, TITLES);
  const books: DemoBook[] = [];
  let titleIndex = 0;
  for (const [publisherIndex, spec] of PUBLISHERS.entries()) {
    const publisher = publishers[publisherIndex] as DemoPublisher;
    for (let position = 0; position < spec.bookCount; position++) {
      const title = titles[titleIndex] as TitleSpec;
      const index = titleIndex++;
      const status = spec.statuses[position] ?? 'published';
      const sells = status === 'published' || status === 'archived';

      const [low, high] = PRICE_RANGE[title.genre];
      const priceCents = pick(
        random,
        PRICE_LADDER.filter((price) => price >= low && price <= high),
      );
      const author = `${pick(random, FIRST_NAMES)} ${pick(random, LAST_NAMES)}`;
      const descriptions = DESCRIPTIONS[title.genre][title.language];

      const sentences = title.language === 'sq' ? SQ_SENTENCES : EN_SENTENCES;
      const chapterTitles = title.language === 'sq' ? CHAPTER_TITLES_SQ : CHAPTER_TITLES_EN;
      const chapters = chapterTitles.slice(0, 2 + (random() < 0.4 ? 1 : 0)).map((chapterTitle) => ({
        title: chapterTitle,
        paragraphs: shuffle(random, sentences).slice(0, 2 + Math.floor(random() * 2)),
      }));

      // 40% of the on-sale books launched in the first week, the rest spread out later.
      let publishedAt: Date | null = null;
      if (sells) {
        const day =
          status === 'archived'
            ? Math.floor(random() * 40)
            : random() < 0.4
              ? Math.floor(random() * 6)
              : 6 + Math.floor(random() * 164);
        publishedAt = new Date(windowStart.getTime() + day * DAY_MS + 6 * HOUR_MS);
      }
      const createdAt = publishedAt
        ? new Date(publishedAt.getTime() - (2 + Math.floor(random() * 9)) * DAY_MS)
        : new Date(windowStart.getTime() + Math.floor(random() * 170) * DAY_MS + 9 * HOUR_MS);

      books.push({
        id: demoUuid('book', index + 1),
        publisherId: publisher.id,
        title: title.title,
        author,
        genre: title.genre,
        language: title.language,
        priceCents,
        isbn13: isbn13(index),
        description: pick(random, descriptions),
        status,
        chapters,
        withCover: !spec.noCover.includes(position),
        cover: pick(random, COVER_PALETTE),
        createdAt,
        publishedAt,
        // Archived 60 to 120 days after it went on sale, and always before now.
        archivedAt:
          status === 'archived' && publishedAt
            ? new Date(
                Math.min(
                  publishedAt.getTime() + (60 + Math.floor(random() * 61)) * DAY_MS + 4 * HOUR_MS,
                  now.getTime() - 2 * DAY_MS,
                ),
              )
            : null,
      });
    }
  }

  // --- Readers -----------------------------------------------------------
  const readers: DemoReader[] = [];
  const seenNames = new Set<string>();
  while (readers.length < DEMO_READER_COUNT) {
    const first = pick(random, FIRST_NAMES);
    const last = pick(random, LAST_NAMES);
    const name = `${first} ${last}`;
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    const index = readers.length + 1;
    readers.push({
      id: demoUuid('reader', index),
      email: `${ascii(first)}.${ascii(last)}@lexues.example`,
      displayName: name,
      countryCode: pickCountry(random),
      createdAt: windowStart, // set below, once the first order is known
    });
  }

  // --- Orders ------------------------------------------------------------
  const popularity = new Map(books.map((book) => [book.id, 0.25 + random() ** 2 * 3]));
  // The archived title sold well while it was on offer.
  for (const book of books) {
    if (book.archivedAt) popularity.set(book.id, (popularity.get(book.id) as number) + 1.5);
  }
  const activity = new Map(readers.map((reader) => [reader.id, 0.2 + random() ** 1.5]));
  const weekFactor = Array.from(
    { length: Math.ceil(DEMO_WINDOW_DAYS / 7) + 1 },
    () => 0.8 + random() * 0.4,
  );
  const owned = new Map<string, Set<string>>(readers.map((reader) => [reader.id, new Set()]));
  const sellable = books.filter((book) => book.publishedAt !== null);
  const orders: DemoOrder[] = [];

  for (let day = 0; day < DEMO_WINDOW_DAYS; day++) {
    const dayStart = new Date(windowStart.getTime() + day * DAY_MS);
    const weekday = dayStart.getUTCDay();
    // A rising trend, a busier weekend and a different mood each week.
    const expected =
      (1.4 + 3.6 * (day / (DEMO_WINDOW_DAYS - 1))) *
      (weekday === 0 || weekday === 6 ? 1.25 : 1) *
      (weekFactor[Math.floor(day / 7)] as number);
    const count = Math.floor(expected) + (random() < expected % 1 ? 1 : 0);

    for (let n = 0; n < count; n++) {
      let paidAtMs = dayStart.getTime() + (8 + random() * 15) * HOUR_MS;
      if (paidAtMs > now.getTime())
        paidAtMs = dayStart.getTime() + random() * (now.getTime() - dayStart.getTime());
      const paidAt = new Date(Math.floor(paidAtMs / 1000) * 1000);

      const onSale = sellable.filter(
        (book) =>
          (book.publishedAt as Date) <= paidAt && (!book.archivedAt || paidAt < book.archivedAt),
      );

      let reader: DemoReader | undefined;
      const wanted: DemoBook[] = [];
      for (let attempt = 0; attempt < 10 && wanted.length === 0; attempt++) {
        reader = weightedPick(random, readers, (r) => activity.get(r.id) as number);
        const library = owned.get(reader.id) as Set<string>;
        const free = onSale.filter((book) => !library.has(book.id));
        if (free.length === 0) continue;
        const size = random() < 0.13 ? (random() < 0.8 ? 2 : 3) : 1;
        const pool = [...free];
        while (wanted.length < size && pool.length > 0) {
          const chosen = weightedPick(random, pool, (book) => popularity.get(book.id) as number);
          wanted.push(chosen);
          pool.splice(pool.indexOf(chosen), 1);
        }
      }
      if (!reader || wanted.length === 0) continue;

      const library = owned.get(reader.id) as Set<string>;
      for (const book of wanted) library.add(book.id);
      orders.push({
        index: orders.length,
        readerId: reader.id,
        bookIds: wanted.map((book) => book.id),
        countryCode: reader.countryCode,
        createdAt: new Date(paidAt.getTime() - (1 + Math.floor(random() * 4)) * 60_000),
        paidAt,
        refund: null,
      });
    }
  }

  // --- Refunds: about 3% in full, exactly one in part ---------------------
  const priceOf = new Map(books.map((book) => [book.id, book.priceCents]));
  const eligible = shuffle(
    random,
    orders.filter((order) => order.paidAt.getTime() <= now.getTime() - 12 * DAY_MS),
  );
  const refundAfter = (order: DemoOrder) =>
    new Date(order.paidAt.getTime() + (1 + Math.floor(random() * 9)) * DAY_MS);

  const partial = eligible.find(
    (order) =>
      order.bookIds.length === 1 && (priceOf.get(order.bookIds[0] as string) as number) >= 699,
  );
  if (partial) {
    const price = priceOf.get(partial.bookIds[0] as string) as number;
    partial.refund = {
      kind: 'partial',
      at: refundAfter(partial),
      amountCents: Math.round((price * 0.4) / 10) * 10,
    };
  }
  const fullCount = Math.round(orders.length * 0.03);
  for (const order of eligible.filter((candidate) => candidate !== partial).slice(0, fullCount)) {
    order.refund = { kind: 'full', at: refundAfter(order) };
  }

  // --- Reader accounts exist before their first purchase ------------------
  for (const reader of readers) {
    const first = orders.find((order) => order.readerId === reader.id);
    const anchor = first ? first.paidAt.getTime() : windowStart.getTime() + 20 * DAY_MS;
    reader.createdAt = new Date(anchor - (1 + Math.floor(random() * 20)) * DAY_MS - 2 * HOUR_MS);
  }

  return { seed, now, windowStart, publishers, books, readers, orders };
}
