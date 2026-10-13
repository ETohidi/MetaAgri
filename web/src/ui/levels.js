// The level model as content (docs/CONCEPT-v2.md section 2): for every level, who uses it, what
// they decide, what goes up, what goes to peers and what never leaves, each with its legal basis,
// plus the cadence, the KPI tiles the level declares and the channels that pass through it.
// Rendered as the "Who uses this level, and what crosses its boundary" panel on every page.
// Germany, Brandenburg and Märkisch-Oderland are the worked example; the farms are fictional.
// test/levels.test.js fails if a level lacks a field or a legal basis.

import { html } from "./dom.js";
import { prov } from "./page.js";
import { ROLES, access } from "./roles.js";

/** Every level must fill these fields (non-empty strings), plus kpis: string[] (1-5 tiles). */
export const LEVEL_FIELDS = [
  "name",
  "user",
  "decides",
  "up",
  "upBasis",
  "peers",
  "peersBasis",
  "never",
  "neverBasis",
  "cadence",
];

/** The ladder the UI shows, top to bottom (level names, never numbers). */
export const LEVEL_ORDER = ["world", "eu", "country", "land", "district", "farm", "field"];

/**
 * Data does not travel up one pipe: six real channels, each with its own chain of authorities,
 * from the farm upward. Each hop names the level it sits at, so a level can show its own hop.
 */
export const CHANNELS = {
  subsidies: {
    name: "Subsidies and compliance",
    chain: [
      ["Farm", "farm"],
      ["District office", "district"],
      ["Paying agency", "land"],
      ["Federal ministry", "country"],
      ["DG AGRI", "eu"],
    ],
    basis: "Reg. (EU) 2021/2116 Art. 98: payments are published with the municipality; the recipient's name only above €1,250 a year",
  },
  water: {
    name: "Water",
    chain: [
      ["Farm", "farm"],
      ["District water authority and water board", "district"],
      ["State environment office", "land"],
    ],
    basis: "Federal Water Act (WHG) and Brandenburg Water Act (BbgWG)",
  },
  animal: {
    name: "Animal health",
    chain: [
      ["Farm", "farm"],
      ["District vet office", "district"],
      ["State ministry", "land"],
      ["FLI", "country"],
      ["EU ADIS", "eu"],
      ["WOAH", "world"],
    ],
    basis: "Animal Health Law, Reg. (EU) 2016/429; WOAH Terrestrial Code ch. 1.1 (notify within 24 hours)",
  },
  plant: {
    name: "Plant health",
    chain: [
      ["Farm", "farm"],
      ["State plant-protection service", "land"],
      ["JKI", "country"],
      ["European Commission", "eu"],
    ],
    basis: "Plant Health Law, Reg. (EU) 2016/2031",
  },
  statistics: {
    name: "Statistics and markets",
    chain: [
      ["Farm", "farm"],
      ["State statistics office", "land"],
      ["Destatis", "country"],
      ["Eurostat", "eu"],
      ["FAO and AMIS", "world"],
    ],
    basis: "Holding-level records go only to Destatis and Eurostat, for statistics only; only tables are published: BStatG §16; Reg. (EU) 2018/1091 Art. 12(3); Reg. (EC) 223/2009 Arts 20-21",
  },
  voluntary: {
    name: "Voluntary sharing",
    twoWay: true,
    chain: [
      ["Farm", "farm"],
      ["Machinery-sharing network, neighbours, buyers", "district"],
    ],
    basis: "EU Code of Conduct on agricultural data sharing (2018); EU Data Act, Reg. (EU) 2023/2854, applies since 12 Sep 2025",
  },
};

export const CHANNEL_ORDER = ["subsidies", "water", "animal", "plant", "statistics", "voluntary"];

export const LEVELS = {
  world: {
    name: "World",
    route: "world",
    user: "FAO and AMIS (the G20 Agricultural Market Information System) analysts; the GEOGLAM Crop Monitor team; WOAH for animal disease.",
    decides:
      "Coordinate crisis policy in the AMIS Rapid Response Forum (days to weeks); publish one agreed crop assessment a month; export bans on food must be notified to the WTO.",
    up: "Nothing above: this is the top level. Publishes the Crop Monitor every month, the AMIS Market Monitor ten times a year, and FAOSTAT every year.",
    upBasis: "FAO Constitution Art. I; WTO Agreement on Agriculture Art. 12",
    peers: "UN agencies (WFP, IFAD), the World Bank, WOAH and the WTO. All AMIS members see one agreed assessment.",
    peersBasis: "AMIS terms of reference (G20, 2011)",
    never:
      "Any farm or field: this level holds country totals and crop-condition classes only, plus public alerts.",
    neverBasis: "UN Fundamental Principles of Official Statistics, principle 6",
    cadence:
      "Crop Monitor monthly; Market Monitor ten times a year; animal-disease alerts within 24 hours; FAOSTAT yearly, 1-2 years behind.",
    kpis: [
      "Farms worldwide",
      "Farms under 2 ha",
      "Farmland those small farms work",
      "Cropland that is irrigated",
      "Food from irrigated land",
    ],
    channels: {
      animal: "WOAH receives outbreak notifications from every country and publishes them.",
      statistics: "FAO and AMIS receive national tables, never farm records.",
    },
  },
  eu: {
    name: "EU",
    route: null, // ladder only: the EU page comes later; EU figures appear on the Country page
    pending: "The EU level has no page yet; its figures appear on the Country page.",
    user: "DG AGRI (farm policy and market crises), JRC MARS (crop-yield forecasts), DG SANTE (animal and plant health), Eurostat.",
    decides:
      "Crisis payments from the agricultural reserve (at least €450 M a year); animal-disease zones, such as for African swine fever (days); monthly yield forecasts; CAP rules and audits of the paying agencies (years).",
    up: "Crop and market data to FAO and AMIS; animal-disease outbreaks, through ADIS, to WOAH.",
    upBasis: "AMIS terms of reference; Reg. (EU) 2016/429",
    peers: "Non-EU partners in the expert group of the European food security crisis mechanism (EFSCM); neighbouring countries for disease zones.",
    peersBasis: "COM(2021) 689 (EFSCM); Reg. (EU) 2023/594",
    never:
      "Single farms' subsidy files: the EU sees totals and audit samples. Farm accounts arrive as anonymised returns from a sample of about 80,000 farms, published only as averages. Recipients' names are published only above €1,250 a year.",
    neverBasis: "Reg. (EU) 2021/2116 Art. 98; GDPR",
    cadence:
      "Yield bulletins monthly; drought maps every 10 days; disease notifications within 24 hours; farm structure survey every 3 years (2023, 2026).",
    kpis: ["Farms in the EU", "Mean farm size", "Land on farms of 50 ha or more"],
    channels: {
      subsidies: "DG AGRI sets the rules and audits each paying agency.",
      animal: "ADIS collects outbreaks from every member state.",
      plant: "The Commission receives pest findings and sets EU-wide measures.",
      statistics: "Eurostat publishes the farm structure tables for every region.",
    },
  },
  country: {
    name: "Country",
    route: "germany",
    user: "Federal ministry BMLEH (called BMEL until May 2025) situation desk; FLI (animal health), JKI (plant health), Destatis (statistics).",
    decides:
      "Aid programmes in a crisis, such as the 2018 drought aid of €340 M (months); federal law and the national CAP strategic plan (years); national animal-disease measures (hours to days).",
    up: "Farm-structure records to Eurostat, for statistics only; outbreaks to the EU animal-disease system ADIS; data to FAO and AMIS; the CAP strategic plan and its yearly reports to the Commission.",
    upBasis: "Reg. (EU) 2018/1091; Reg. (EU) 2016/429; Reg. (EU) 2021/2115",
    peers:
      "The 16 Länder through the conference of agriculture ministers and the joint federal-state task for farm structure (GAK). Other countries see German totals only, as Germany sees theirs.",
    peersBasis: "Basic Law Art. 91a; GAK Act",
    never: "Single farms and fields: the federal level gets statistics tables and per-district disease reports, never a holder's data.",
    neverBasis: "BStatG §16 (statistical confidentiality); GDPR",
    cadence:
      "Animal disease within 24 hours; crop and harvest reports during the season; farm structure survey every 3 years; a full count of all farms every 10 years.",
    kpis: ["Farms", "Mean farm size", "Farmland", "Irrigated share", "Wheat yield"],
    channels: {
      subsidies: "The federal ministry writes the national CAP strategic plan and reports to the Commission.",
      animal: "FLI confirms outbreaks as the national reference lab and runs the system through which the federal ministry reports to ADIS.",
      plant: "JKI is the national plant-protection authority and reports to the Commission.",
      statistics: "Destatis compiles the Länder surveys and sends the holding-level records to Eurostat, for statistics only.",
    },
  },
  land: {
    name: "Land",
    route: null, // ladder only: the Brandenburg page comes in v2.1
    pending: "The Land page (Brandenburg) is coming in v2.1.",
    user: "State ministry MLEUV, the EU paying agency for Brandenburg and Berlin, LELF (state agriculture office, with the plant-protection service), LfU (state environment office: main rivers and dikes).",
    decides:
      "Pays and checks the CAP subsidies (yearly, checks all season); pest warnings (days); flood alarm levels on the main rivers (hours).",
    up: "Survey records to Destatis, for statistics only; subsidy totals and check results to the federal ministry and the Commission; pest findings to JKI; outbreaks to FLI.",
    upBasis: "BStatG; Reg. (EU) 2021/2116; Reg. (EU) 2016/2031",
    peers:
      "Other Länder through the conference of agriculture ministers; Berlin shares the paying agency; the Polish side of the Oder for floods.",
    peersBasis: "Berlin-Brandenburg state treaty on agriculture (LwStV); German-Polish border waters agreement (1992)",
    never: "Farm finances and private machine data; per-parcel subsidy files outside payment and checks.",
    neverBasis: "Reg. (EU) 2021/2116 Art. 98 (recipients' names published only above €1,250 a year); GDPR",
    cadence:
      "Subsidy applications yearly (by 15 May); pest warnings weekly in the season; flood alarm levels hourly during a flood.",
    kpis: ["Farms", "Mean farm size", "Farmland", "Wheat yield", "Irrigated area"],
    channels: {
      subsidies: "The paying agency pays, checks on the spot and publishes the payments (recipients' names only above €1,250 a year).",
      water: "The state environment office runs the main rivers, the dikes and the flood alarm levels.",
      animal: "The state ministry runs the crisis unit and reports outbreaks to FLI.",
      plant: "The plant-protection service watches for pests and sends warnings.",
      statistics: "The state statistics office surveys the farms; records go on only to Destatis and Eurostat, and only tables are published.",
    },
  },
  district: {
    name: "District",
    route: "oderbruch",
    user: "District authorities of Märkisch-Oderland (water authority, vet office, agriculture office); the water and dike association GEDO; the machinery-sharing network of the farms.",
    decides:
      "Bans on taking surface water (days to seasons); animal-disease zones (hours); pump water out of the polder or hold it (hours); checks subsidy applications (yearly); brokers machines and silo space between farms (days).",
    up: "Per-farm data only inside each channel: water permits and use to the state environment office, herd and outbreak reports to the state ministry, checked subsidy applications to the paying agency.",
    upBasis: "WHG §§ 8, 100; Animal Health Act (TierGesG) §4 and its reporting ordinance; Reg. (EU) 2021/2116",
    peers:
      "Neighbouring districts, Berlin and the Polish side for floods and disease zones. Between farms only voluntary offers: a combine free on Tuesday, 280 t of silo space.",
    peersBasis: "Reg. (EU) 2023/594 (disease zones); EU Code of Conduct on agricultural data sharing",
    never:
      "Crop plans, prices and farm finances; one authority's per-farm files to another (the water authority does not see the vet office's herd records).",
    neverBasis: "GDPR Art. 5(1)(b) (purpose limitation)",
    cadence:
      "Bans and disease zones within hours when needed; pump decisions daily in a wet spell; subsidy checks yearly; machinery offers daily at harvest.",
    kpis: ["Farms needing help", "Combines free", "Silo space offered", "Surface-water ban", "Farms in the district"],
    channels: {
      subsidies: "The district agriculture office takes and checks the applications.",
      water: "The water authority sets permits and bans; the water board runs the ditches and pumps.",
      animal: "The vet office sets disease zones, checks herds and reports outbreaks.",
      voluntary: "The machinery-sharing network brokers offers between member farms.",
    },
  },
  farm: {
    name: "Farm",
    route: "lerchenbruch", // our own (fictional) farm; neighbours have their own routes
    user: "The farm manager of a fictional farm, Hof Lerchenbruch, with its planners, Coordinator and Safety check in the twin.",
    decides:
      "The crop plan and the subsidy application (yearly); approve or reject the daily plan (daily); keep the spray records (electronic from 2027 in Germany).",
    up: "To each authority only what its channel needs: the subsidy application with each parcel's crop, water taken against the permit, disease reports, survey answers.",
    upBasis: "Reg. (EU) 2021/2116; WHG; Reg. (EU) 2016/429 Art. 18 and TierGesG §3 (disease); Reg. (EU) 2023/564 as amended by 2025/2203 and §11 PflSchG (spray records)",
    peers:
      "Only offers that expire (a combine free on Tuesday, 280 t of silo space) and its status in a word. Neighbours, beekeepers and buyers get notices about approved work.",
    peersBasis: "Voluntary, by agreement: EU Code of Conduct on agricultural data sharing; EU Data Act",
    never: "Raw field and machine data, yields, prices and finances, to anyone without the farm's consent.",
    neverBasis: "EU Data Act, Reg. (EU) 2023/2854 Art. 4-5; Trade Secrets Act (GeschGehG)",
    cadence: "A plan every day in the season; offers valid for a few days; the subsidy application once a year.",
    kpis: ["Fields at risk", "Water used vs permit", "Harvest progress", "Silo space free", "Help needed"],
    channels: {
      subsidies: "Applies once a year, with the crop on every parcel.",
      water: "Reports the water it takes against its permit.",
      animal: "Reports a notifiable disease at once (this demo farm keeps no animals).",
      plant: "Reports quarantine pests and keeps its spray records.",
      statistics: "Answers the farm surveys; the answers are used for statistics only and published only as tables.",
      voluntary: "Decides what it offers, to whom and for how long.",
    },
  },
  field: {
    name: "Field",
    route: "lerchenbruch.north",
    user: "The agronomist and the field agent of one parcel (North, West or River field agent); the shapes are fictional.",
    decides: "Irrigate, spray, harvest or sow, and how much (hours to days).",
    up: "Everything to its own farm: soil moisture, crop stage and health, disease risk, yield estimate and what was done.",
    upBasis: "Internal to the farm (the farm's own data)",
    peers: "Nothing directly: neighbours hear only through the farm's notices, such as spraying near hives or harvest dates.",
    peersBasis: "Through the farm only, by its choice",
    never: "Raw sensor and machine data, outside the farm and the service providers it chooses.",
    neverBasis: "EU Data Act, Reg. (EU) 2023/2854; EU Code of Conduct on agricultural data sharing",
    cadence: "Daily in the twin; real soil sensors report every 15 minutes to every hour.",
    kpis: ["Soil moisture vs stress line", "Days to harvest", "Disease risk", "Yield estimate"],
  },
};

/** One-line notes for levels with a local twist. */
const HERE_NOTE = {
  world: "Countries hold the data; this level sees their totals and condition classes.",
  country:
    "Farming is run largely by the 16 Länder; the federal level sees Land and district totals and the disease reports.",
  land: "Brandenburg is the worked example; its page comes in v2.1.",
  district:
    "In Brandenburg the Land and the district hold different powers: the Land pays subsidies and runs the main rivers, the district issues water bans and disease zones.",
  farm: "Hof Lerchenbruch and its neighbours are fictional; every number about them is simulated.",
  field: "The fields are fictional shapes; real parcels would carry only their official crop and area.",
};

/** What a role sees at a level, in words (roles.js ACCESS). */
const ACCESS_WORDS = {
  full: "sees this level in full",
  aggregate: "sees totals, status bands, public orders and voluntary offers only",
  none: "sees nothing of this level; it is not shared with this role",
};

function channelRows(key, notes) {
  return CHANNEL_ORDER.filter((c) => notes[c]).map((c) => {
    const ch = CHANNELS[c];
    return html`<li>
      <h4>${ch.name}</h4>
      <p>${notes[c]}</p>
      <ol class="levels-chain${ch.twoWay ? " is-two-way" : ""}" aria-label="${ch.name}: chain from the farm upward">
        ${ch.chain.map(([who, lv]) => (lv === key ? html`<li class="is-here">${who}</li>` : html`<li>${who}</li>`))}
      </ol>
      <p class="levels-basis">${ch.basis}</p>
    </li>`;
  });
}

/**
 * "Who uses this level, and what crosses its boundary", with the level ladder on top and, where
 * it matters, the channels that pass through the level.
 * @param {string} key  one of LEVEL_ORDER
 * @param {{place?: string, links?: Object<string, string>, role?: string}} opts
 *   links: level key -> route token for ladder links; role: a roles.js id, adds what it sees here
 */
export function levelsPanel(key, { place = "", links = {}, role = "" } = {}) {
  const L = LEVELS[key];
  if (!L) return "";
  const note = HERE_NOTE[key] ? ` ${HERE_NOTE[key]}` : "";
  const lens = ROLES[role] ? ` Viewing as ${ROLES[role].name}: ${ACCESS_WORDS[access(role, key)]}.` : "";
  const notes = L.channels ?? {};
  const hasChannels = CHANNEL_ORDER.some((c) => notes[c]);
  return html`
    <section class="pane levels" aria-labelledby="levels-title">
      <header class="pane-head">
        <div>
          <h2 id="levels-title">Who uses this level, and what crosses its boundary</h2>
          <p>
            ${place ? `${place} at ${L.name} level.` : `${L.name} level.`}${note}${lens} A real deployment would enforce
            these rules on a server; this static site only illustrates them.
          </p>
        </div>
        ${prov("illustrative", { title: "Describes the real reporting rules; the static site cannot enforce them" })}
      </header>
      <ol class="levels-ladder" aria-label="Levels">
        ${LEVEL_ORDER.map((k) => {
          const lv = LEVELS[k];
          if (k === key) return html`<li aria-current="step" class="is-here">${lv.name}</li>`;
          const token = links[k] ?? lv.route;
          if (token) return html`<li><a href="#${token}">${lv.name}</a></li>`;
          return html`<li class="is-soon" title="${lv.pending ?? ""}">${lv.name}</li>`;
        })}
      </ol>
      <div class="levels-grid">
        <div>
          <h3>Who uses it</h3>
          <p>${L.user}</p>
          <p class="levels-sub">${L.decides}</p>
        </div>
        <div>
          <h3>Shares up</h3>
          <p>${L.up}</p>
          <p class="levels-basis">${L.upBasis}</p>
        </div>
        <div>
          <h3>With peers</h3>
          <p>${L.peers}</p>
          <p class="levels-basis">${L.peersBasis}</p>
        </div>
        <div class="is-never">
          <h3>Never leaves</h3>
          <p>${L.never}</p>
          <p class="levels-basis">${L.neverBasis}</p>
        </div>
      </div>
      ${
        hasChannels
          ? html`<div class="levels-channels">
              <h3>Channels through this level</h3>
              <p class="levels-ch-lead">Farm data does not travel up one pipe: each channel has its own chain of authorities.</p>
              <ul class="levels-ch-list">
                ${channelRows(key, notes)}
              </ul>
            </div>`
          : ""
      }
      <footer class="pane-foot">
        <span><b>Cadence:</b> ${L.cadence}</span>
      </footer>
    </section>
  `;
}
