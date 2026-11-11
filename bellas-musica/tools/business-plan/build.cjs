// Builds the Bella's Fiestas business plan in the layout of the SBDC "Lean" template.
// Usage: node build.js out.docx '{"exec":3,...}'  (page numbers for the table of contents)
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, HeadingLevel, PageBreak, ShadingType, LevelFormat, TabStopType, PositionalTab,
  PositionalTabAlignment, PositionalTabRelativeTo, PositionalTabLeader, VerticalAlign
} = require("docx");

const OUT = process.argv[2] || "plan.docx";
const PAGES = Object.assign({ exec: 3, mgmt: 3, market: 4, target: 4, need: 4, comm: 4, comp: 5, funds: 6, fin: 8, app: 11 }, JSON.parse(process.argv[3] || "{}"));
const IMG = path.join(__dirname, "img"); // cover photo from the SBDC template; chart drawn from the plan's numbers
const SERIF = "Times New Roman", SANS = "Calibri", BLUE = "2F5496";

// "**bold**", "*italic*", "[[highlighted placeholder]]" inside a string -> runs
function runs(text, base = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[\[[^\]]+\]\])/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...base }));
    const s = m[0];
    if (s.startsWith("**")) out.push(new TextRun({ ...base, text: s.slice(2, -2), bold: true }));
    else if (s.startsWith("[[")) out.push(new TextRun({ ...base, text: s.slice(2, -2), highlight: "yellow" }));
    else out.push(new TextRun({ ...base, text: s.slice(1, -1), italics: true }));
    last = m.index + s.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...base }));
  return out;
}
const P = (text, opts = {}) => new Paragraph({ children: runs(text, opts.run || {}), spacing: { after: 160, line: 264 }, ...opts.para });
const H1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
const H2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
const LABEL = (text) => new Paragraph({ children: [new TextRun({ text, bold: true })], spacing: { before: 120, after: 80 }, keepNext: true });
const bullet = (text) => new Paragraph({ children: runs(text), numbering: { reference: "bullets", level: 0 }, spacing: { after: 80, line: 264 } });
const numbered = (text) => new Paragraph({ children: runs(text), numbering: { reference: "steps", level: 0 }, spacing: { after: 80, line: 264 } });
const brk = () => new Paragraph({ children: [new PageBreak()] });
const spacer = (twips) => new Paragraph({ children: [], spacing: { before: twips, after: 0 } });

// a plain table with a light-blue header row
const GRID = { style: BorderStyle.SINGLE, size: 4, color: "A6A6A6" };
function table(widths, rows, { boldLast = false, small = true } = {}) {
  const total = widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA }, columnWidths: widths,
    rows: rows.map((r, ri) => new TableRow({
      tableHeader: ri === 0, cantSplit: true,
      children: r.map((c, ci) => new TableCell({
        width: { size: widths[ci], type: WidthType.DXA },
        borders: { top: GRID, bottom: GRID, left: GRID, right: GRID },
        shading: ri === 0 ? { type: ShadingType.CLEAR, color: "auto", fill: "D9E2F3" } : undefined,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({
          children: runs(String(c), { size: small ? 20 : 24, bold: ri === 0 || (boldLast && ri === rows.length - 1) || undefined }),
          alignment: ci > 0 && (/^(\*\*)?(\$|\d)/.test(String(c)) || /^(\*\*)?about \$/.test(String(c)) || (ri === 0 && /^Year|^Per month/.test(String(c)))) ? AlignmentType.RIGHT : AlignmentType.LEFT
        })]
      }))
    }))
  });
}

// the Use of Funds layout: a borderless 3-column table, amounts on underlined lines like the template
const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const LINE = { style: BorderStyle.SINGLE, size: 6, color: "000000" };
function fundsTable(rows) {
  const widths = [2100, 4860, 2400];
  return new Table({
    width: { size: 9360, type: WidthType.DXA }, columnWidths: widths,
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows: rows.map(([label, item, amount, opts = {}]) => new TableRow({
      cantSplit: true,
      children: [label, item, amount].map((c, ci) => new TableCell({
        width: { size: widths[ci], type: WidthType.DXA },
        borders: { top: NONE, left: NONE, right: NONE, bottom: ci === 2 && amount !== "" && amount != null ? LINE : NONE },
        margins: { top: 0, bottom: 0, left: 80, right: 80 },
        verticalAlign: VerticalAlign.BOTTOM,
        children: [new Paragraph({
          spacing: { before: opts.gap ? 160 : 0, after: 0, line: 252 },
          tabStops: ci === 2 ? [{ type: TabStopType.RIGHT, position: 2200 }] : undefined,
          children: ci === 2 && amount !== "" && amount != null
            ? [new TextRun({ text: "$\t" + amount, bold: opts.bold })]
            : runs(String(c || ""), { bold: opts.bold && ci === 1 ? true : undefined, color: ci === 1 && opts.grey ? "595959" : undefined })
        })]
      }))
    }))
  });
}

// table of contents line with dot leader, like the template's
function tocLine(text, page, indent = false) {
  return new Paragraph({
    indent: indent ? { left: 220 } : undefined, spacing: { after: 100 },
    tabStops: [{ type: TabStopType.RIGHT, position: 9350, leader: "dot" }],
    children: [new TextRun({ text: text + "\t" + page, font: SANS, size: 22 })]
  });
}

// ---------------- content ----------------
const cover = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new ImageRun({ type: "jpg", data: fs.readFileSync(path.join(IMG, "cover-000.jpg")), transformation: { width: 620, height: 190 } })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun("BUSINESS PLAN")] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun("for")] }),
  spacer(1700),
  ...[
    ["BELLA'S FIESTAS", true],
    ["Xavier Valencia and Abby Castaneda", false],
    ["[[Business address]]", false],
    ["[[City, State ZIP]]", false],
    ["[[Phone number]]", false],
    ["holabellasfiestas@gmail.com", false],
    ["[[Website, once the domain is bought]]", false]
  ].map(([t, b]) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 180 }, children: runs(t, { bold: b || undefined }) })),
  brk()
];

const toc = [
  tocLine("EXECUTIVE SUMMARY", PAGES.exec),
  tocLine("MANAGEMENT TEAM", PAGES.mgmt),
  tocLine("MARKET", PAGES.market),
  tocLine("TARGET MARKET", PAGES.target, true),
  tocLine("MARKETPLACE NEED", PAGES.need, true),
  tocLine("COMMERCIALIZATION POTENTIAL", PAGES.comm, true),
  tocLine("POTENTIAL COMPETITORS AND COMPETITIVE EDGE", PAGES.comp, true),
  tocLine("USE OF FUNDS", PAGES.funds),
  tocLine("FINANCIAL PROJECTIONS", PAGES.fin),
  tocLine("APPENDIX", PAGES.app),
  brk()
];

const exec = [
  H1("Executive Summary"),
  P("Bella's Fiestas is an online marketplace, owned by co-founders Xavier Valencia and Abby Castaneda, that lets Chicago-area families book everything for a party in one place. The owners will form Bella's Fiestas LLC, a two-member Illinois limited liability company, in November 2026. They started the company because booking a mariachi, a banda or a caterer for a quinceañera still means calling around, waiting days for prices and paying cash deposits with no protection, and they have seen their own families go through it."),
  P("The Company's mission is to make planning a Latino family celebration simple, fair and safe, in Spanish and English. Through a website that installs like a phone app, families search by ZIP code and see real prices, open dates and reviews for music (mariachi, banda, norteño, DJs), food, tent and table rentals, decorations, photographers and videographers, party staff, venues and dress and suit alterations. They book with a card deposit that is refunded if the vendor does not show up. Competitors such as GigSalad, The Bash and Thumbtack are national, English-first directories that charge vendors for leads or memberships; most local vendors still book through Facebook and WhatsApp. Bella's Fiestas stands apart with a fully bilingual experience, instant prices, a calendar that prevents double booking, an arrival code that proves the vendor showed up, and free listings: vendors pay only a 10% fee when a family books and pays."),
  P("The target market is Cook County and the surrounding suburbs, home to about 1.3 million Latino residents, and the families planning quinceañeras, weddings, baptisms and birthdays there. The app is built and tested. The owners are not requesting a loan: they will fund about $3,525 of start-up costs themselves (legal setup, a trademark filing, accounting setup, launch marketing and three months of operating costs), and the business is projected to cover its own monthly costs at about 12 bookings a month."),
  spacer(200),
  H1("Management Team"),
  P("The Company is run by its two co-founders, who will own it 50/50 (to be confirmed in the operating agreement) and draw no salary in the first year. There are no employees at launch, so there is no payroll and no payroll tax."),
  LABEL("Payroll chart, year 1"),
  table([1500, 1700, 3260, 1300, 1600], [
    ["Person", "Title", "Responsibilities", "Weekly hours", "Pay (year 1)"],
    ["Xavier Valencia", "Co-founder, Technology and Families", "Runs the app and its settings; checks vendors' licenses and insurance before badges are shown; helps families with bookings and refunds; handles payments and the books with the accountant", "[[hours]]", "No salary; owner draws from profit"],
    ["Abby Castaneda", "Co-founder, Vendors and Marketing", "Recruits and signs up vendors; runs Instagram, TikTok and Facebook; builds partnerships with churches, dress shops and halls; gathers vendor reviews", "[[hours]]", "No salary; owner draws from profit"]
  ]),
  spacer(120),
  P("**How the owners will be paid.** As a two-member LLC taxed as a partnership, each owner takes draws from the profit in line with the ownership split. There is no W-2 payroll. Each owner pays self-employment tax (15.3%) and income tax on their share of the profit, so the Company sets aside 25% of profit for taxes before any draw. No paid time off, retirement or other benefits are offered in the first year."),
  P("**Support the owners already have.** Software assistants built into the app answer families' and vendors' questions and draft reports, vendor outreach and social posts each morning; nothing goes out until an owner approves it. The owners are advised by the Illinois Small Business Development Center at SIU Carbondale and will choose an attorney and an accountant from the SBDC's referrals."),
  P("**First hire.** A part-time, bilingual vendor-and-family support person, considered in year 2 once bookings pass about 60 a month."),
  brk()
];

const market = [
  H1("MARKET"),
  H2("TARGET MARKET"),
  P("The Company serves Latino families in the City of Chicago and suburban Cook County first, starting in Pilsen, Little Village, Back of the Yards, Cicero and Berwyn. It has two kinds of customer: the families who book and the vendors who get booked."),
  table([3400, 3560, 2400], [
    ["Area (2020 Census, approximate)", "Latino residents", "Share of population"],
    ["City of Chicago", "about 820,000", "about 29%"],
    ["Cook County", "about 1.3 million (up 11% since 2010)", "about 26%"],
    ["Illinois", "about 2.3 million", "about 18%"]
  ]),
  P("About 1 in 5 Chicagoans is of Mexican origin. [[Confirm these figures on data.census.gov before sharing the plan with a lender.]]", { para: { spacing: { before: 120, after: 160 } } }),
  bullet("**Families (the buyers):** parents and relatives planning quinceañeras, weddings, baptisms, first communions, birthdays, graduations and serenatas. Many read Spanish first and plan on a phone. As a rough estimate, about 10,000 Latina girls in Cook County turn 15 each year (1.3 million residents × about 1.6% in each one-year age group ÷ 2), and most quinceañeras hire music, food, a hall and a dress fitting."),
  bullet("**Vendors (the sellers):** mariachis, bandas, norteño groups, DJs, taqueros and caterers, bakers, tent and chair rentals, decorators, photographers and videographers, security, party halls and seamstresses. Most are small, family-run and find clients through Facebook, Instagram and word of mouth."),
  bullet("**Measurable impact:** a family sees a price and open dates in minutes instead of waiting days for call-backs; the deposit is refunded if the vendor never arrives; a vendor gets only paid, confirmed requests and never pays for a lead."),
  spacer(120),
  H2("MARKETPLACE NEED"),
  P("Booking a party in the Chicago Latino community is slow, informal and risky. Prices are rarely posted, so families message several groups and wait. Deposits are often paid in cash or by Zelle with no protection if the group cancels or never arrives. National booking sites are in English, are built for weddings and corporate events, and charge vendors for leads that may not turn into work. Vendors, in turn, juggle dates in notebooks and chats and sometimes get double-booked. Bella's Fiestas solves this with posted prices, live calendars, a protected card deposit, an arrival code that proves the vendor showed up, and everything in Spanish and English."),
  spacer(120),
  H2("COMMERCIALIZATION POTENTIAL"),
  P("**Industry growth and opportunity.** Cook County's Latino population grew about 11% from 2010 to 2020, much faster than the county as a whole, and families now discover vendors on TikTok, Instagram and WhatsApp rather than in directories. No booking platform in Chicago is built for Spanish-speaking families. After Chicago, the same app can serve other Illinois cities with large Latino communities (Aurora, Elgin, Waukegan, Joliet) and then other metro areas, with no new software to build."),
  P("**Go-to-market and sales strategy.** The owners will launch in phases:"),
  numbered("**Founding vendors (months 1–3):** sign up 25 local vendors, starting with family and community contacts. Founding vendors pay a 5% fee for their first 6 months. The owners will visit vendors in person and hand out printed flyers with a QR code that opens the sign-up page."),
  numbered("**Families (from month 2):** post daily on Instagram, TikTok and Facebook using the Company's social media kit; place flyers in churches, dress and quinceañera shops and party halls; and publish Spanish and English neighborhood pages that show up in Google searches such as “mariachi Pilsen”."),
  numbered("**Word of mouth (ongoing):** every vendor gets a share kit with a booking link and QR code to post on its own pages, and vendors who invite other vendors pay half the fee for 30 days."),
  P("The software can handle any number of bookings; the limit in year 1 is the owners' time to sign up vendors, about 5 to 10 a week. The plan assumes an average booking of $600, 240 bookings in year 1 and growth to about 150 a month by year 3. Marketing costs about $100 a month in social media ads plus about $300 in printing and first ads at launch. Families return for the next party: the app saves their favorite vendors, a party plan, a guest list with WhatsApp RSVPs and reviews.", { para: { spacing: { before: 120, after: 160, line: 264 } } }),
  P("**Business and revenue model.** The Company earns money only when a family pays:"),
  bullet("**Booking fee:** 10% of the booking total, taken from the family's deposit (6% for vendors on the Pro plan; 5% for the first 25 founding vendors for 6 months). Listing is free and tips go 100% to the vendor."),
  bullet("**Vendor upgrades, each for 30 days:** Featured placement $49, Spotlight at the top of every list $99, Pro $29 (lower fee and more photos)."),
  bullet("**Payment links:** a 3% fee when a vendor uses the app to collect from its own clients."),
  P("The main direct costs are card processing (2.9% + 30¢ on each deposit, about $4.65 on a $150 deposit) and Stripe's charge of about $2 a month for each vendor paid that month. On a $600 booking the Company keeps about $55 of its $60 fee, a gross margin of about 91%. Operating costs are about $300 a month in year 1, for an estimated profit margin of about 59% in year 1, before owner draws and income taxes.", { para: { spacing: { before: 120, after: 160, line: 264 } } }),
  brk()
];

const comp = [
  H2("POTENTIAL COMPETITORS AND COMPETITIVE EDGE"),
  P("The Company's closest competitors are three national booking sites and, most of all, vendors' own Facebook, Instagram and WhatsApp pages. The figures below come from the owners' research in September and October 2026 (search results and review sites) and are approximate."),
  table([1500, 2000, 1800, 1900, 2160], [
    ["Competitor", "What it offers", "How it charges vendors", "Strengths", "Weaknesses for Chicago Latino families"],
    ["GigSalad", "National entertainment directory; mariachi is one of its top categories, with thousands of reviews", "About 4–5% per booking, plus optional paid plans of about $25–50 a month", "Large audience, many reviews, free quotes, a refund guarantee if a performer cancels", "English only; music and entertainment only; performers complain about paying for promotion; some customers report denied refunds after no-shows"],
    ["The Bash", "Event-vendor directory since 1997", "About 5% per booking ($20 minimum) plus a yearly membership of about $99–199", "Verified reviews; a money-back guarantee on payments made through it", "English only; vendors pay a membership before earning anything; quotes take time"],
    ["Thumbtack", "General local-services marketplace that also lists musicians and party vendors", "Pay per lead, reported at $30 to $100 or more, even when the customer never replies", "Very large audience, strong Google presence", "Vendors widely complain about paying for leads that never book; not built for quinceañeras or Spanish speakers"],
    ["Vendors' own social media", "Facebook, Instagram and WhatsApp pages", "Free", "Personal, in Spanish, trusted by word of mouth", "No posted prices or calendars, slow replies, cash deposits with no protection, hard to compare"]
  ]),
  spacer(160),
  P("**The Company's competitive edge:**"),
  bullet("**Built for the community.** Every screen, email and text is in Spanish and English, with quinceañeras, serenatas, padrinos and the court of honor built in."),
  bullet("**Instant prices and live calendars.** Families see the full price, the deposit and open dates before contacting anyone, and a booked time closes automatically so vendors are never double-booked."),
  bullet("**Protected deposits.** A 4-digit arrival code proves the vendor showed up. If a vendor does not show and the family reports it within 3 days, the family gets back everything it paid in the app. New vendors' payouts are held until their first 3 events are checked in."),
  bullet("**Fair to vendors.** Listing is free, there are no membership or lead fees, and every request arrives with a paid deposit, so it is a real client. Founding vendors pay only 5% for 6 months, less than GigSalad or The Bash."),
  bullet("**The whole party in one place.** Music, food, rentals, decorations, photo and video, staff, venues and alterations, plus free planning tools: a budget, a guest list with WhatsApp RSVPs and a signed booking agreement."),
  brk()
];

const funds = [
  H1("Use of Funds"),
  spacer(120),
  fundsTable([
    ["Amount Needed", "Amount to be Financed", "0"],
    ["", "Owner's Investment", "3,525"],
    ["", "Competition Award", "0"],
    ["", "Total Start Up Costs", "3,525", { bold: true, gap: true }],
    ["Use of Funds", "Land", "0", { gap: true, grey: true }],
    ["", "Land Improvements", "0", { grey: true }],
    ["", "Building", "0", { grey: true }],
    ["", "Building Renovations", "0", { grey: true }],
    ["", "Carpet & Fixtures", "0", { grey: true }],
    ["", "Vehicles", "0", { grey: true }],
    ["", "Office Furniture & Equip.", "0", { grey: true }],
    ["", "General Equipment", "0", { grey: true }],
    ["", "Tools", "0", { grey: true }],
    ["", "Computers & Peripherals", "0", { grey: true }],
    ["", "Initial Product Inventory", "0", { grey: true }],
    ["", "Cleaning/Office Supplies", "0", { grey: true }],
    ["", "Permits & Licensing Fees", "510", { grey: true }],
    ["", "Licensed Professional Fees", "1,800", { gap: true, grey: true }],
    ["", "Launch Marketing", "300", { grey: true }],
    ["", "Website Domain", "15", { grey: true }],
    ["", "Working Capital", "900", { gap: true, grey: true }],
    ["", "Total Start Up Costs", "3,525", { bold: true, gap: true }],
    ["Repayment", "Period (years to repay loan): none", "", { gap: true }],
    ["", "Source: Business Cash Flow", ""],
    ["Collateral", "None required: no loan requested", "", { gap: true }],
    ["", "Equipment", "0"],
    ["", "Furniture/Fixtures", "0"],
    ["", "Building", "0"],
    ["", "Equity in real estate (if applicable)", "0"],
    ["   Other:", "Savings", "0"],
    ["", "Stocks", "0"],
    ["", "Personal real estate", "0"],
    ["", "Total", "0", { bold: true, gap: true }]
  ]),
  spacer(240),
  LABEL("Notes on start-up costs"),
  bullet("**Permits & Licensing Fees ($510):** Illinois LLC filing $153.38; federal trademark application for the name, about $350; copyright (DMCA) agent registration $6. A City of Chicago business license, if required, is extra."),
  bullet("**Licensed Professional Fees ($1,800):** attorney review of the Terms of Service and Privacy Policy, the operating agreement and name protection (estimate $1,500); accountant setup (estimate $300). [[Replace with the quotes from the SBDC's referrals.]]"),
  bullet("**No buildings, equipment or inventory:** the business runs online from home, the owners use their own iPad and phones, and vendors provide the services."),
  bullet("**Working Capital ($900):** 3 months of operating costs at about $300 a month."),
  brk()
];

const titlePage = (text, font, size) => [
  ...Array.from({ length: 17 }, () => new Paragraph({ children: [] })),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, font, size, color: BLUE })], spacing: { after: 300 } })
];

const fin = [
  ...titlePage("FINANCIAL PROJECTIONS", SERIF, 26),
  brk(),
  LABEL("Summary"),
  P("The Company is projected to earn about $12,240 in year 1 and $116,100 by year 3, with a profit before owner draws and taxes of about $7,160 in year 1. These are the owners' estimates, not results: the app has not yet taken a real booking."),
  LABEL("Key assumptions"),
  bullet("Launch in early 2027, after the LLC, EIN, bank account and Stripe account are set up."),
  bullet("Average booking: $600 (a mix of music, food, rentals and smaller items such as alterations). [[Owners: confirm or change the $600 average.]]"),
  bullet("Average fee: 7% in year 1, because most early vendors are founding vendors at 5%; 9.5% in years 2 and 3 (10% standard, 6% for Pro)."),
  bullet("Vendor upgrades (Featured, Spotlight, Pro): about 4 a month in year 1, 10 in year 2 and 25 in year 3, at about $45 each."),
  bullet("Card processing: about $4.65 per booking (2.9% + 30¢ on a $150 deposit)."),
  bullet("Profit is shared by the owners; 25% is set aside for taxes."),
  LABEL("Year 1 bookings by month"),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new ImageRun({ type: "png", data: fs.readFileSync(path.join(IMG, "chart.png")), transformation: { width: 620, height: Math.round(620 * 668 / 1344) } })] }),
  P("At the 5% founding fee each booking earns the Company about $25 after card fees, so about 12 bookings a month cover the $300 in monthly costs; at the standard 10% fee it takes about 6."),
  brk(),
  LABEL("Monthly operating costs, year 1"),
  table([6560, 2800], [
    ["Cost", "Per month"],
    ["Website hosting and storage (Render)", "$7.50"],
    ["Text messages (Twilio)", "$15"],
    ["AI helpers (capped at $8 a day; expected use)", "$30"],
    ["Business email (free plan)", "$0"],
    ["Business insurance (estimate; ask a broker)", "$40"],
    ["Accountant and bookkeeping (estimate)", "$100"],
    ["Illinois LLC annual report ($75 a year)", "$6.25"],
    ["Domain name ($12 a year)", "$1"],
    ["Social media ads", "$100"],
    ["**Total**", "**about $300**"]
  ]),
  spacer(200),
  LABEL("Three-year projection"),
  table([3960, 1800, 1800, 1800], [
    ["", "Year 1", "Year 2", "Year 3"],
    ["Bookings", "240", "720", "1,800"],
    ["Bookings paid to local vendors", "$144,000", "$432,000", "$1,080,000"],
    ["Booking fee revenue", "$10,080", "$41,040", "$102,600"],
    ["Vendor upgrade revenue", "$2,160", "$5,400", "$13,500"],
    ["**Total revenue**", "**$12,240**", "**$46,440**", "**$116,100**"],
    ["Card processing", "$1,116", "$3,348", "$8,370"],
    ["Stripe vendor payout charges", "$360", "$960", "$2,400"],
    ["Operating costs", "$3,600", "$5,400", "$9,600"],
    ["**Total costs**", "**$5,076**", "**$9,708**", "**$20,370**"],
    ["**Profit before owner draws and taxes**", "**$7,164**", "**$36,732**", "**$95,730**"],
    ["Tax set-aside (25%)", "$1,791", "$9,183", "$23,933"],
    ["Available for owner draws", "$5,373", "$27,549", "$71,797"]
  ]),
  spacer(160),
  P("Operating costs rise to about $450 a month in year 2 and $800 in year 3, mostly for more advertising. They do not include a part-time support hire in year 2, which would cost about $1,300 a month for 15 hours a week at $20 an hour. If bookings come in at half the plan, year 1 revenue is about $6,100 and the Company still covers its costs."),
  brk()
];

const appendix = [
  ...titlePage("APPENDIX", "Calibri Light", 28),
  P("The following supporting documents are attached:", { para: { spacing: { before: 200, after: 120 } } }),
  bullet("Terms of Service and Privacy Policy (version of November 11, 2026), once reviewed by the attorney"),
  bullet("How to Use Bella's Fiestas guide, for families, vendors and the owners"),
  bullet("Vendor sign-up flyer with QR code"),
  bullet("Screenshots of the app: search, a vendor page, booking and the vendor dashboard"),
  bullet("Social media kit: profile image, posts and the 2-week launch plan"),
  bullet("Illinois LLC Articles of Organization and EIN letter, once filed"),
  bullet("Signed operating agreement between Xavier Valencia and Abby Castaneda"),
  bullet("Short resumes for both owners"),
  bullet("Letters of interest from the first founding vendors, if available"),
  P("**Sources:** population figures are approximate 2020 Census numbers as reported by the University of Illinois Chicago Great Cities Institute, WBEZ and ABC7 Chicago. Competitor fees come from the owners' research in September and October 2026. App features, fees and costs come from Bella's Fiestas' own settings and setup guides.", { para: { spacing: { before: 240, after: 160 } }, run: { size: 20 } })
];

const doc = new Document({
  creator: "Xavier Valencia and Abby Castaneda",
  title: "Business Plan for Bella's Fiestas",
  styles: {
    default: { document: { run: { font: SERIF, size: 24 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: SERIF, size: 26, color: BLUE }, paragraph: { spacing: { before: 0, after: 120 }, keepNext: true, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { font: SERIF, size: 24, color: BLUE }, paragraph: { spacing: { before: 0, after: 100 }, keepNext: true, outlineLevel: 1 } }
    ]
  },
  numbering: { config: [
    { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
    { reference: "steps", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 300 } } } }] }
  ] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    children: [...cover, ...toc, ...exec, ...market, ...comp, ...funds, ...fin, ...appendix]
  }]
});

Packer.toBuffer(doc).then((b) => { fs.writeFileSync(OUT, b); console.log("wrote", OUT); });
