# Competitors: who they are, what they do better, what we did about it

Research date: September 2026. Sources are web-search results (linked at the bottom). **Several competitor sites blocked my automated page fetches (GigSalad, Serenattia and others), so the numbers below come from search-result excerpts and third-party comparison pages, not from reading their own pricing pages.** Treat prices and percentages as directional and check them yourself before quoting them to anyone.

## The list

| Competitor | What it is | How it makes money | What people like | What people complain about |
| --- | --- | --- | --- | --- |
| **GigSalad** | The biggest US entertainment directory; mariachi is its #3 category. Search results show 7,500+ mariachi reviews (4.8 average), and an average of about 1.4 days from request to booking. Chicago is the top city for mariachi requests in Illinois. | Commission on bookings (about 5% per one comparison page) and/or yearly membership fees for performers, plus paid promotion. | Reach, review volume, quotes are free, a "Worry-Free Guarantee" (refund if a performer cancels). | Performers: paying for promotion and still getting unfair reviews; account frozen after a complaint. Customers: cases where a performer no-showed and the refund was denied (BBB and complaint-site posts). |
| **The Bash** | Directory since 1997. | Pay per quote request (roughly $15-$60 per request per one comparison page) or a subscription. | Verified reviews; says deposits and balances paid through it are covered by a 100% money-back guarantee. | Same pay-to-play pattern for groups. |
| **Thumbtack** | General local-services marketplace that also lists musicians. | Groups pay per lead, reported at $30-$100+, whether or not the customer replies. | Big audience. | Community forums and the BBB show many complaints about fake or "just exploring" leads, refunds only as credits, and one solo musician reporting 62 paid leads (over $1,000) for 4 gigs. |
| **Scarlett Entertainment, GigHeaven** | Agency and directory sites that also list mariachi. | Agency margin or directory fees. | Concierge feel for big events. GigHeaven shows an average Latin/mariachi price of about $1,286 in Chicago. | Slow (request a quote, wait), not built around Spanish-speaking families. |
| **Serenattia** (Mexico) | An app to hire mariachis and musicians in about 40 Mexican cities. **Closest in spirit to your idea, but not in the US.** | (Not confirmed.) | ID-verified musicians, protected payment held until the event, QR-code confirmation that the musicians arrived. | n/a (not in your market). |
| **Bands' own sites, Facebook, Instagram, WhatsApp** | Groups like Mariachi Ameca and Mariachi Flor de Primavera take bookings directly. | Nothing: word of mouth. | Free, personal, in Spanish. | No price transparency, no calendar, no protection, hard to compare. This is your **real competitor** in Chicago. |
| **Gigwell, Sonicbids, Bandsintown** | Tools for touring artists (EPKs, calendars, ticketing). | Subscriptions. | Good artist tooling. | Not aimed at families booking a quinceañera. Not really competitors. |

## Where they beat us today (be honest with yourself)

1. **Scale and trust.** GigSalad has years of reviews and a brand people recognise. A new site has neither. Your fix is local density (Chicago) and real groups people already know, not features.
2. **A guarantee backed by a big company.** The Bash and GigSalad promise money back. Yours works the same way now (below), but you are the one paying if a Stripe refund reverses on a group that has already spent the money.
3. **Search-engine traffic.** They rank for "mariachi band Chicago". You have share pages and a sitemap, but no content yet.
4. **Insurance and contracts for corporate/venue clients.** Halls sometimes require a certificate of insurance. You have the Insured badge (only where you've seen proof) and now a printable agreement.

## Where we are better, and what we built for it

| Their weakness | What we do | Where it lives |
| --- | --- | --- |
| **Pay-per-lead, fake leads (Thumbtack, The Bash).** | Groups never pay for leads. A customer must pay a deposit before a request even reaches the group, so every request is real. Fee only on paid bookings. | Money model (already built); now stated on the Chicago page. |
| **Slow quotes (days).** | Instant price: the customer sees totals, travel fee, deposit and open dates before contacting anyone. One-tap quote request and private custom offers for the odd events. | Search, group page, offers. |
| **No-shows, with refunds denied (GigSalad complaints).** | **Show-up guarantee**: a 4-digit arrival code the customer shows on the day; the group enters it to check in. A group that never checked in can be reported within 3 days; you review both sides in Admin and refund everything paid in the app in one click, reversing the group's payout. | New this round. |
| **Paid promotion that people distrust.** | Promoted cards are always labelled "Promoted", and unpaid groups still appear in the feed and in search. | Discover feed. |
| **Nothing built for Spanish-speaking families.** | Whole site, emails and texts in English and Spanish; Mexican event types (quinceañera, serenata); WhatsApp sharing. | Everywhere. |
| **Discovery is a search box.** | **Discover**: a swipeable feed of short clips of local groups, the way people already find music on TikTok and Instagram. Groups can pay to appear more often. | New this round. |
| **No paperwork.** | A printable **booking agreement** (parties, event, price, payments, cancellation policy, guarantee) for the family, the venue or the hall. | New this round. |
| **Groups' calendars are a mess.** | Groups open dates once; the site never double-books; customers can request a new date with the slot held while the group decides. | Already built. |

## Built since the first version of this report

- **Neighborhood and event landing pages** (`/chicago/pilsen/quinceanera` and so on): real groups and prices, structured data, only in the sitemap when a real group stands behind them. After launch, add your site to Google Search Console and submit `/sitemap.xml`.
- **Saved groups and shareable shortlists:** heart a group anywhere; send a link to your partner or family chat.
- **TikTok and Instagram clips in Discover**, next to YouTube and Vimeo. Verified with stand-in players only, not the real TikTok and Instagram embeds (see the README note).

- **Get quotes, with a twist (GigSalad's headline feature):** GigSalad's "fast free quote" reaches many performers and performers complain the leads are blanket blasts they pay for. Here a request goes to at most 5 groups that are free that day, play that event, fit the guest count and are in range, and costs groups nothing.
- **"Events booked here":** the equivalent of GigSalad's verified-booking count. It only counts confirmed events that already happened with the money not refunded, so a refunded no-show removes itself. It starts at zero for everyone, and that is the honest starting line.

- **GigSalad's quote flow, studied from a real run** (12 screens, one question each with a progress ring: category, group size, ZIP, date, start time, length, budget range, planning stage, name, phone, email, password). What we took: one question per screen, the account created last, and the four details groups need to quote (start time, budget, group size, planning stage). What we did differently: their phone step tells you providers will *call* you; ours promises your phone and email are never shared with groups, and the account step is one screen instead of four.

## Built in October 2026, after a second look at the competition

Second research pass (October 2026; search excerpts and review sites, check before quoting): GigSalad takes about **4%** per booking plus optional paid plans of about $25-50 a month and reported 25,000+ music bookings in 2025; The Bash takes **5%** ($20 minimum) plus a reported $99-199 yearly membership; Thumbtack charges per lead; The Knot and Zola give free planning tools (budget, checklist, guest list with RSVPs, a website) but only for weddings and in English; the Quinceanera.com app is rated 2.1★ and Quincy is planning only; HoneyBook sells contracts and invoices to vendors for about $29-129 a month. Our 10% looked like double their headline fee, we started at zero reviews, and families had no guest list. What we built:

| Gap | What we built | Where |
| --- | --- | --- |
| **Our fee looked twice theirs** | **Founding vendors**: the first 25 listings to go live pay 5% for 6 months (lower than GigSalad and The Bash, no membership, no lead fees). Shown on the new-listing form, the draft banner, the welcome page and the Payments tab | `FOUNDING_SLOTS`, `FOUNDING_FEE_PCT`, `FOUNDING_DAYS` |
| **Zero reviews against years of reviews** | **Past-client reviews**: up to 10 per listing, by a one-time link the vendor sends by email or WhatsApp; labelled "Past client", never counted as booked here, guarded against self-reviews, removable by you | Dashboard → Reviews; Admin |
| **Contracts are a paid tool elsewhere (HoneyBook)** | **The agreement is signed in the app** by both sides, with the terms fingerprinted so a changed booking needs new signatures | Booking → Agreement |
| **Guest list and RSVPs (The Knot, Zola)** | **Guest list with WhatsApp invitations and RSVPs**, an open link for the family chat, totals feeding the guest count, and the **court of honor and padrinos**: built for quinceañeras, in both languages | Saved party |
| **A guarantee backed by real money (The Bash)** | **New vendors' deposits are held** until they check in at the party (first 3 events), so a no-show refund never has to be clawed back; established vendors are paid at booking like before | `HOLD_NEW_VENDOR_EVENTS` |
| **"Verified" meant only our own check** | **ID checked** badge from Stripe's identity check for payouts (we never see the ID) | Cards, group page, Discover |
| **Spanish searches find nothing** | **Spanish neighborhood/event pages** (`/es/chicago/pilsen/quinceanera`, `/boda`, `/cumpleanos`…) linked to the English ones | Sitemap |

Sources for this pass: [GigSalad on Hypebot](https://www.hypebot.com/gigsalad-booked-live-gigs-worth-113-million-for-indie-artists.md), [Music Gateway on GigSalad](https://www.musicgateway.com/blog/how-to/gigsalad-review-is-gigsalad-worth-it-for-creatives), [The Bash pricing](https://thebash.com/pricing-payments), [The Bash membership (sidehusl)](https://sidehusl.com/?p=7366), [Thumbtack pro page](https://thumbtack.com/pro/referral/NqHJPyc6xgwzwI0), [Quinceanera.com app](https://apps.apple.com/us/app/id1084512701), [Quincy](https://apps.apple.com/app/id1491304785), [The Knot vs Zola](https://guestcam.co/blog/the-knot-vs-zola), [HoneyBook pricing 2026](https://assembly.com/blog/honeybook-pricing).

## Ideas not built yet, in the order I would do them

1. **Serenata-now:** a same-day, short "surprise serenata" flow (Mother's Day is the peak). Serenattia's whole product is this. It needs same-day booking (today a booking must be for a future date) and time-of-day rules for groups.
2. ~~ID verification~~ and ~~holding payouts until check-in~~: built (see above).
3. **Sound control for TikTok/Instagram clips** in Discover, and a fallback if a group's account is private or the embed asks visitors to log in.

## Privada and Vibra Connect: why they stayed small (October 20, 2026)

These are the two apps closest to us: both are built for Mexican music (banda, norteño, mariachi, sierreño, DJs) and
Latino parties. Both are small. We found them through App Store listings, news articles and web searches. The app
stores and the apps' own websites couldn't be opened from our research computer, so the numbers below come from search
results and may be a little out of date.

| | **Privada - Plan Your Fiesta** | **Vibra Connect - Event Vendors** |
| --- | --- | --- |
| Who | Cristian Moreno, a 28-year-old truck driver and corrido singer from Hemet, CA. He built it alone and sold his car to pay for it. | "Vibra Connect", sold by PH Consulting Services LLC (a consulting company). |
| Since | Mid-2025 (judging by its App Store number). News stories ran in May 2026 (La Opinión, BeLatina, LatidoBeat). | 2026, very new. |
| Ratings | About 31–34 ratings, 4.8 stars (iPhone). | 2 ratings, 3.0 stars. |
| Size claimed | "Almost 3,000 businesses", across the US and into Mexico. | Not stated. |
| How you book | You don't. You find a group and tap to send a **pre-filled text message**. Everything after that happens off the app. | "Request quotes" and "booking requests". No sign of payments or protection. |
| Money | Free to list. In-app purchases, with "premium packages" maybe later. | Not stated. |
| Phones | iPhone listing (news says Android too). App only, no website to browse. | iPhone (built for iPad) and Google Play. App only. |
| Social media | No official Instagram or TikTok account turned up in searches. One wave of press, then quiet. | None found. The name "Vibra" is shared with radio stations, nightclubs and dozens of apps, so it can't be searched. |
| Complaints | Crashed when choosing an artist. Missing genres ("Tierra Caliente"). Odd 18+ rating. | Two ratings averaging 3 stars is the first thing anyone sees. |

### Why they have so few ratings and so little buzz

1. **Nothing happens inside the app, so nothing brings people back.** Privada hands you a text message, and the deal
   happens on the phone. No booking, no deposit, no "how was your party?" afterwards. App Store ratings and reviews come
   from happy moments *inside* the app, and there aren't any. That's why "3,000 businesses" turned into only ~34 ratings.
2. **Too wide, too thin.** All of the US plus Mexico at once, with one founder working part-time. In any one city a family
   finds a few groups, sees no reviews, and leaves. Marketplaces live or die on whether a search finds someone good *in
   your town*.
3. **App-only.** To look at a single mariachi you have to install an app first. Most families won't for a one-time
   party. There are no web pages for Google to show when someone searches "mariachi para quinceañera Chicago".
4. **No social engine.** The groups themselves are very active on TikTok (#norteñobanda, "disponibles para privadas",
   phone numbers in every caption: Chicago groups like Clave Privada do exactly this). Neither app gives groups a reason
   or a tool to send those followers to the app.
5. **One burst of press, then silence.** The May 2026 stories were great, but news brings a spike, not a habit. There
   was no steady weekly content after.
6. **First impressions.** Vibra Connect's 3.0 from 2 ratings scares people off. A name nobody can search. A generic
   English listing for a Spanish-first audience. Privada's crashes, missing genres and an 18+ rating that hides it from
   younger users planning a quince.
7. **No trust layer.** Neither protects the deposit or checks that the group shows up, so families have no reason to
   pick them over calling the group they saw on TikTok.

### What Bella's Fiestas already does differently

- **A website first, apps second.** Families browse without installing anything. Every vendor has a page Google can
  show, plus English and Spanish pages for each neighborhood and event.
- **The whole booking happens here.** Price before signing up, a deposit protected by the Show-up guarantee, then an
  automatic review request after the party. Reviews come from real bookings.
- **Doesn't start at zero.** Past-client reviews (up to 10, labelled), "Nuevo" instead of a scary low score, and sample
  listings without fake stars.
- **One city first.** Chicago only, with a founding-vendor deal and an outreach kit (`docs/chicago-launch.md`).
- **A name that is ours.** Searching "Bella's Fiestas" finds nothing else.

### What we built because of this research

1. **Share kit for vendors** (dashboard, Requests tab): their booking link, captions ready to paste for TikTok and
   Instagram in Spanish and English (with hashtags), a bio line, a QR code to print for their stand and flyers, and
   tips. The groups' own followers become our customers, and every booking brings a verified review.
2. **"Searches that found nobody"** on the Admin page: what families looked for, and where, when they found no one
   (searches and Get quotes). This is the number that sank both apps. Recruit those vendors first.
3. **The music families ask for:** Sierreño, Tierra Caliente, Cumbia / Sonido and Tamborazo are now vendor types.

### The growth plan (do these, in this order)

1. **Density before size.** Pilsen, Little Village, Back of the Yards and Cicero first. Don't open a new area until
   most searches there find someone. Watch "Searches that found nobody" weekly.
2. **Every vendor uses the share kit on day one.** When you sign up a group, help them put the link in their TikTok and
   Instagram bio and post the Spanish caption. Their followers are free customers.
3. **Our own TikTok and Instagram, 3–4 posts a week, in Spanish first.** Short clips (with permission) of groups at
   real parties, "¿cuánto cuesta un mariachi en Chicago?" price explainers, quinceañera planning tips, and "a family
   booked through Bella's Fiestas" stories. Use the handle @bellasfiestas everywhere (claim it now on TikTok,
   Instagram, Facebook and YouTube).
4. **Reviews from day one.** Collect past-client reviews when a vendor joins. Remind every family after the party
   (automatic). Answer every review.
5. **Press is a spark, not a fire.** Pitch La Opinión, Telemundo Chicago, Univision Chicago, Chicago Tribune Hoy and
   local Spanish radio once there are real stories (the first 100 bookings, a quinceañera saved by the Show-up
   guarantee). Then keep posting.
6. **Be where parties are planned.** Quinceañera expos, church halls, dress and cake shops, salones: flyers with a QR
   code that opens a Get-quotes page with their partner code (`?src=`).
7. **Only then the app stores**, both iPhone and Android, with a Spanish listing, real screenshots, a 4+ rating, and
   only after there are reviews to show.

## Sources

- [GigSalad vs Thumbtack vs The Bash (overview page)](https://turnermagic.com/gig-site-dilemma/)
- [Events in Minutes vs GigSalad, 2026](https://www.eventsinminutes.com/blog/eim-vs-gigsalad-comparison-2026/)
- [Why sites like GigSalad and The Bash may be hurting performers](https://www.christophergracelive.com/post/the-hidden-costs-sites-like-the-bash-and-gigsalad-why-performers-and-clients-both-lose)
- [GigSalad: Mariachi bands in Chicago](https://www.gigsalad.com/Music-Groups/Mariachi-Band/IL/Chicago)
- [The Bash: Mariachi bands](https://www.thebash.com/services/mariachi-band)
- [GigHeaven: Latin / Salsa / Mariachi in Chicago](https://www.gigheaven.com/search/latin-salsa-mariachi-entertainment/united-states/chicago.html)
- [Serenattia: how the app works (Spanish)](https://serenattia.com/blog/app-para-contratar-mariachi-musicos-como-funciona)
- [Thumbtack Community: fake leads discussions](https://community.thumbtack.com/discussion/2029/leads-are-always-saying-found-another-pro-all-saying-scamming-pros-fake-leads)
- [GigSalad BBB complaints](https://www.bbb.org/us/mo/springfield/profile/entertainment-bureau/gigsalad-llc-0734-23720/complaints)
- [Mariachi Ameca](https://mariachiameca.com/), [Mariachi Flor de Primavera](https://www.mariachiflordeprimavera.com/)
- Privada on the App Store: https://apps.apple.com/us/app/privada-plan-your-fiesta/id6748003948
- Privada ratings and reviews: https://apps.apple.com/us/app/privada-plan-your-fiesta/id6748003948?see-all=reviews&platform=iphone
- BeLatina, "Privada, the Latino App That Wants to Be the Yelp of Party Planning…": https://belatina.com/privada-the-latino-app-that-wants-to-be-the-yelp-of-party-planning-was-built-by-a-truck-driver-who-sold-his-car-to-make-it-happen/
- La Opinión, "Latino crea una aplicación para organizar eventos en el sur de California" (May 29, 2026): https://laopinion.com/2026/05/29/latino-crea-una-aplicacion-para-organizar-eventos-en-el-sur-de-california/
- LatidoBeat, "Privada: La app para organizar fiestas en EE. UU. y México" (May 28, 2026): https://thelatidobeat.com/2026/05/28/encontrar-grupos-fiestas-privada/
- Vibra Connect on the App Store: https://apps.apple.com/us/app/vibra-connect-event-vendors/id6797997255
- Vibra Connect on Google Play: https://play.google.com/store/apps/details?id=app.vibraconnect.marketplace
- TikTok, groups advertising private parties in Chicago: https://www.tiktok.com/discover/grupos-norte%C3%B1os-para-contratar-en-chicago
- Why two-sided marketplaces fail (liquidity): https://www.raftlabs.com/blog/two-sided-marketplace-failure-rate

