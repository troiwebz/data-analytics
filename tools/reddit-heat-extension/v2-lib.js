// v2-lib.js — the Growth Board: where we post, what we offer, what we write.
//
// v1 hunts other people's threads and messages them. That is push, and push
// is the weakest move on Reddit. v2 is pull: we post value into rooms that
// contain people with budgets, answer in public, and let the buyers come to
// us. Everything here is plain data and pure functions so `node v2-test.js`
// can check it without a browser.
const V2 = (globalThis.V2 = globalThis.V2 || {});

// ---------------------------------------------------------------- targets
// kind  — ads: people already spending money and complaining about it
//         owner: a trade's own room, where the buyer has no marketing team
//         biz: general business rooms, big but noisier
// promo — what the room tolerates. This is our starting guess; the board
//         re-checks every subreddit against Reddit itself (subscribers,
//         whether it still exists, whether text posts are allowed) so a
//         wrong guess here is corrected by the tool, not by us.
//         no     → never post an offer; answer in the comments only
//         weekly → offers belong in the sub's weekly/self-promo thread
//         value  → a post is fine if it gives before it asks
//         ok     → self-promotion is allowed outright
V2.TARGETS = [
  // --- people who already spend money on ads ---
  { sub: "PPC", kind: "ads", promo: "value", note: "Ad spenders debugging campaigns. Teardowns land; pitches get removed." },
  { sub: "FacebookAds", kind: "ads", promo: "value", note: "Meta buyers. Post creative and account teardowns." },
  { sub: "GoogleAds", kind: "ads", promo: "value", note: "Search buyers. Wasted-spend audits do well." },
  { sub: "adwords", kind: "ads", promo: "value", note: "Older Google Ads room, still active." },
  { sub: "SEO", kind: "ads", promo: "no", note: "Strict. Answer in comments, never post an offer." },
  { sub: "bigseo", kind: "ads", promo: "no", note: "Senior SEO room. Reputation only, never an offer." },
  { sub: "TechSEO", kind: "ads", promo: "no", note: "Technical. Good for credibility, not offers." },
  { sub: "juststart", kind: "ads", promo: "value", note: "Beginners building sites. Playbooks land." },
  { sub: "marketing", kind: "ads", promo: "no", note: "Big and strict about promotion. Comment first, always." },
  { sub: "DigitalMarketing", kind: "ads", promo: "value", note: "Mixed. Result posts do well." },
  { sub: "advertising", kind: "ads", promo: "no", note: "Agency-side industry talk. Credibility only, not leads." },
  { sub: "content_marketing", kind: "ads", promo: "value", note: "Playbooks and teardowns." },
  { sub: "Emailmarketing", kind: "ads", promo: "value", note: "Dead-list revival offers fit here." },
  { sub: "analytics", kind: "ads", promo: "no", note: "Tracking and measurement questions. Answering them earns trust fast." },
  { sub: "GoogleAnalytics", kind: "ads", promo: "no", note: "GA4 pain. Free fixes earn trust." },
  { sub: "GoogleTagManager", kind: "ads", promo: "no", note: "Conversion tracking. Very high-intent comments." },
  { sub: "SocialMediaMarketing", kind: "ads", promo: "value", note: "IG/TikTok buyers." },
  { sub: "socialmedia", kind: "ads", promo: "value", note: "Broad social room. Creative packs and teardowns land here." },
  { sub: "Affiliatemarketing", kind: "ads", promo: "value", note: "Performance-minded. Pay-on-results offers fit." },
  { sub: "agency", kind: "ads", promo: "value", note: "Other agencies — partners and white-label, not clients." },
  { sub: "PPCMastery", kind: "ads", promo: "value", note: "Smaller PPC room, easier to be seen in than r/PPC." },
  { sub: "GoogleBusinessProfile", kind: "ads", promo: "value", note: "Exactly our local audit offer's room." },
  { sub: "LocalSEO", kind: "ads", promo: "value", note: "Local pack reports belong here." },

  // --- business owners in their own rooms (the real buyers) ---
  { sub: "dentistry", kind: "owner", promo: "no", note: "Practice owners. Comment-first, then they DM." },
  { sub: "Dentists", kind: "owner", promo: "no", note: "Smaller than r/dentistry and heavier on practice owners." },
  { sub: "optometry", kind: "owner", promo: "no", note: "Private practice owners competing with chains locally." },
  { sub: "Chiropractic", kind: "owner", promo: "no", note: "Small clinics, heavy local-search need." },
  { sub: "physicaltherapy", kind: "owner", promo: "no", note: "Cash-pay clinics buy marketing." },
  { sub: "medspa", kind: "owner", promo: "value", note: "High ticket, heavy ad spend. Best owner room we have." },
  { sub: "Lawyertalk", kind: "owner", promo: "no", note: "Solo firms. Very high case value." },
  { sub: "LawFirm", kind: "owner", promo: "no", note: "Firm operations and intake — intake is a marketing problem." },
  { sub: "Accounting", kind: "owner", promo: "no", note: "Practice owners in the off-season." },
  { sub: "InsuranceAgent", kind: "owner", promo: "value", note: "Agents buying leads already." },
  { sub: "realtors", kind: "owner", promo: "no", note: "Agents, obsessed with lead generation and already paying for it." },
  { sub: "RealEstate", kind: "owner", promo: "no", note: "Huge and mostly consumers. Comment only, for reach." },
  { sub: "Contractor", kind: "owner", promo: "value", note: "Trades owners. Our strongest fit." },
  { sub: "HVAC", kind: "owner", promo: "no", note: "Technicians and owners mixed; the owners talk about slow seasons." },
  { sub: "hvacadvice", kind: "owner", promo: "no", note: "Mostly homeowners — comment for reach, not leads." },
  { sub: "Plumbing", kind: "owner", promo: "no", note: "Owners answer in the comments here more than they post." },
  { sub: "Roofing", kind: "owner", promo: "value", note: "Owners buy leads constantly." },
  { sub: "Electricians", kind: "owner", promo: "no", note: "Trade room; the owners are in the comments, not the posts." },
  { sub: "Construction", kind: "owner", promo: "no", note: "Broad trades room, owners mixed with crew. Comment only." },
  { sub: "landscaping", kind: "owner", promo: "value", note: "Seasonal spend spikes." },
  { sub: "PestControl", kind: "owner", promo: "value", note: "Route businesses, local search heavy." },
  { sub: "AutoDetailing", kind: "owner", promo: "value", note: "Owner-operators, very active." },
  { sub: "Welding", kind: "owner", promo: "no", note: "Job shops looking for more work coming through the door." },
  { sub: "restaurateur", kind: "owner", promo: "value", note: "Restaurant owners; covers, delivery apps and local search." },
  { sub: "Bartenders", kind: "owner", promo: "no", note: "Staff rather than owners, so no offers ever go here." },
  { sub: "smallbusiness", kind: "biz", promo: "weekly", note: "The single best audit-magnet room. Use the weekly promo thread for offers." },
  { sub: "gym", kind: "owner", promo: "no", note: "Members and owners mixed; owner threads are worth answering." },
  { sub: "personaltraining", kind: "owner", promo: "value", note: "Trainers who need clients." },
  { sub: "Fitness", kind: "owner", promo: "no", note: "Consumers, not gym owners. Kept out of the offer rotation." },
  { sub: "Esthetician", kind: "owner", promo: "value", note: "Solo operators, booking-driven." },
  { sub: "Hairstylist", kind: "owner", promo: "no", note: "Chair renters and salon owners chasing a full book." },
  { sub: "tattooadvice", kind: "owner", promo: "no", note: "Consumers asking about tattoos, not artists buying marketing." },
  { sub: "Veterinary", kind: "owner", promo: "no", note: "Clinic owners and practice managers; high client value." },
  { sub: "photography", kind: "owner", promo: "no", note: "Freelancers who need bookings but guard their wallets." },
  { sub: "WeddingPhotography", kind: "owner", promo: "value", note: "Booking-season spend." },
  { sub: "moving", kind: "owner", promo: "value", note: "Movers buy local leads year-round." },
  { sub: "juniordev", kind: "biz", promo: "no", note: "Not buyers at all. Listed so it stays out of the rotation." },

  // --- general business rooms ---
  { sub: "Entrepreneur", kind: "biz", promo: "no", note: "Huge and hostile to promotion. Result posts and comments only." },
  { sub: "EntrepreneurRideAlong", kind: "biz", promo: "value", note: "Build-in-public. Result posts do very well." },
  { sub: "sweatystartup", kind: "biz", promo: "value", note: "Service businesses — trades, cleaning, local. Great fit." },
  { sub: "business", kind: "biz", promo: "no", note: "Broad business talk, low intent. Comment only." },
  { sub: "ecommerce", kind: "biz", promo: "value", note: "Store owners with real ad spend and constant creative fatigue." },
  { sub: "shopify", kind: "biz", promo: "value", note: "Store owners. Creative and CRO offers." },
  { sub: "Etsy", kind: "biz", promo: "no", note: "Sellers with small budgets; useful for reach, rarely for retainers." },
  { sub: "FulfillmentByAmazon", kind: "biz", promo: "no", note: "Amazon sellers, different channel." },
  { sub: "dropship", kind: "biz", promo: "value", note: "Low budgets, high ad appetite." },
  { sub: "SaaS", kind: "biz", promo: "value", note: "B2B founders, longer sales cycles but real budgets." },
  { sub: "msp", kind: "owner", promo: "value", note: "IT shops. High contract value, weak marketing." },
  { sub: "Franchising", kind: "biz", promo: "value", note: "Multi-location — our best ticket size." },
  { sub: "PrintShop", kind: "owner", promo: "value", note: "Local print shops that live or die on nearby search." },
  { sub: "CommercialCleaning", kind: "owner", promo: "value", note: "Contract cleaners chasing B2B leads." },
  { sub: "forhire", kind: "biz", promo: "ok", note: "Offers allowed outright, but price-driven and low ticket." },
  { sub: "B2BForHire", kind: "biz", promo: "ok", note: "Business-to-business hiring." },
  { sub: "DoneDirtCheap", kind: "biz", promo: "ok", note: "Very low ticket. Use only to build karma." },
];

// A wider bench so the rooms can be chosen by preference rather than taken as
// given. Tuple form to keep it readable: [sub, kind, posting rule, what it is].
// Every one of these is checked against Reddit by the Targets tab — anything
// that does not exist, or is private, is marked there rather than silently
// wasting a posting slot.
V2.MORE_TARGETS = [
  // --- ads, search, social, analytics ---
  ["AskMarketing", "ads", "value", "Open marketing questions, lighter moderation than r/marketing."],
  ["GrowthHacking", "ads", "value", "Growth tactics; playbooks and teardowns do well."],
  ["growmybusiness", "biz", "ok", "Built for owners asking for growth help. Offers are welcome."],
  ["Business_Ideas", "biz", "value", "Idea stage mostly, but owners pass through."],
  ["Entrepreneurship", "biz", "no", "Discussion room, promo removed on sight."],
  ["solopreneur", "biz", "value", "One-person businesses that outsource marketing early."],
  ["smallbusinessUK", "biz", "weekly", "UK owners; offers belong in the weekly thread."],
  ["smallbusinesscanada", "biz", "value", "Canadian owners, smaller and friendlier."],
  ["AusSmallBusiness", "biz", "value", "Australian owners, high service-business mix."],
  ["copywriting", "ads", "no", "Copywriters, not buyers. Good for credibility only."],
  ["conversionoptimization", "ads", "value", "CRO and landing pages — our landing teardown fits exactly."],
  ["landingpage", "ads", "value", "People posting pages for critique. Free teardowns land."],
  ["AmazonPPC", "ads", "value", "Amazon sellers with real daily ad spend."],
  ["AmazonSeller", "biz", "no", "Sellers; different channel but real budgets."],
  ["adops", "ads", "no", "Ad operations, technical. Credibility only."],
  ["programmatic", "ads", "no", "Programmatic buyers, enterprise side."],
  ["MarketingAutomation", "ads", "value", "Automation and lifecycle — dead-list revival fits."],
  ["Emailmarketinghelp", "ads", "value", "Smaller email room, asks are practical."],
  ["hubspot", "ads", "no", "Tool users; owners with a CRM already in place."],
  ["YouTubeAds", "ads", "value", "Video buyers, smaller and less crowded."],
  ["TikTokAds", "ads", "value", "TikTok buyers; creative packs fit here best."],
  ["InstagramMarketing", "ads", "value", "IG growth and ads; creative-led."],
  ["SEOhelp", "ads", "value", "Beginner SEO asks; easy place to be useful."],
  ["seogrowth", "ads", "value", "Smaller SEO room with less moderation."],
  ["webdev", "ads", "no", "Developers, not buyers. Skip for offers."],
  ["Wordpress", "biz", "no", "Site owners with technical problems; answer them."],
  ["shopifystore", "biz", "value", "Store critique room; free teardowns welcome."],
  ["EcommerceMarketing", "ads", "value", "Store owners specifically about marketing."],
  ["FacebookAdvertising", "ads", "value", "Second Meta room, less crowded than r/FacebookAds."],
  ["PPCHelp", "ads", "value", "Direct help requests from people running ads."],

  // --- trades and home services ---
  ["Carpentry", "owner", "no", "Trade room; shop owners in the comments."],
  ["Flooring", "owner", "value", "Installers and shop owners chasing local jobs."],
  ["Concrete", "owner", "no", "Contractors; seasonal demand swings."],
  ["Excavation", "owner", "no", "Heavy civil and site work contractors."],
  ["Painting", "owner", "value", "Painting contractors, heavily local-search driven."],
  ["PressureWashing", "owner", "value", "Owner-operators who buy leads constantly."],
  ["WindowCleaning", "owner", "value", "Route businesses; local search is everything."],
  ["JunkRemoval", "owner", "value", "Very high intent, very local, high ad spend."],
  ["Locksmith", "owner", "no", "Emergency trade; Maps ranking decides the calls."],
  ["GarageDoorService", "owner", "value", "Emergency trade with strong local pack value."],
  ["appliancerepair", "owner", "no", "Technicians and small shop owners."],
  ["HandymanBusiness", "owner", "value", "New owners building a customer pipeline."],
  ["poolcleaning", "owner", "value", "Route businesses, seasonal spend."],
  ["fencing", "owner", "value", "Fence contractors, project-based and local."],
  ["Solar", "owner", "value", "Solar installers, expensive leads and big budgets."],
  ["homeinspectors", "owner", "value", "Referral-driven but buying search now."],
  ["propertymanagement", "owner", "value", "Managers with portfolios and marketing budgets."],
  ["selfstorage", "owner", "value", "Facility owners; local pack decides occupancy."],
  ["Moving", "owner", "value", "Movers who already buy leads year round."],
  ["Towing", "owner", "no", "Emergency trade, Maps-led."],
  ["Autobody", "owner", "no", "Body shops competing on local search."],
  ["MechanicAdvice", "owner", "no", "Mostly consumers; shop owners answer. Comment only."],
  ["Diesel", "owner", "no", "Fleet and shop owners."],
  ["Trucking", "owner", "no", "Carriers and owner-operators, different channel."],
  ["logistics", "biz", "value", "Freight and 3PL, B2B lead generation."],
  ["Manufacturing", "biz", "value", "Job shops that have never marketed."],
  ["Screenprinting", "owner", "value", "Print shops chasing local B2B orders."],
  ["Embroidery", "owner", "value", "Small shops with a local customer base."],
  ["signmaking", "owner", "value", "Sign shops, local B2B buyers."],

  // --- health, legal, money ---
  ["Orthodontics", "owner", "no", "Practice owners with very high case value."],
  ["dentalhygiene", "owner", "no", "Staff room; use only to understand the trade."],
  ["Dermatology", "owner", "no", "Cosmetic side is heavily advertised."],
  ["PlasticSurgery", "owner", "no", "Consumers and surgeons; very high ad spend."],
  ["therapists", "owner", "no", "Private practices filling caseloads."],
  ["psychotherapy", "owner", "no", "Clinicians; directory and local search led."],
  ["Counselling", "owner", "no", "Private practice owners."],
  ["homecare", "owner", "value", "Home care agencies, expensive leads."],
  ["Nursing", "owner", "no", "Staff room, not buyers. Kept out of rotation."],
  ["CFP", "owner", "no", "Financial planners building a book."],
  ["Bookkeeping", "owner", "value", "Bookkeepers who need a steady client flow."],
  ["taxpros", "owner", "no", "Tax preparers; brutal seasonality."],
  ["Mortgages", "owner", "no", "Loan officers who buy leads already."],
  ["InsuranceProfessional", "owner", "value", "Agents and agency owners."],
  ["RealEstateTechnology", "owner", "value", "Agents buying tools and lead systems."],
  ["appraisal", "owner", "no", "Appraisers; small but local-search dependent."],

  // --- beauty, fitness, food, events, pets ---
  ["Barber", "owner", "no", "Shop owners and chair renters."],
  ["Nailtechs", "owner", "no", "Solo operators filling a book."],
  ["massage", "owner", "no", "Therapists and small studios."],
  ["Cosmetology", "owner", "no", "Salon professionals; booking-led."],
  ["eyelashextensions", "owner", "value", "Solo techs who advertise on IG already."],
  ["tattooartists", "owner", "no", "Artists filling their calendar."],
  ["foodtrucks", "owner", "value", "Owners who live on social reach."],
  ["Chefit", "owner", "no", "Working chefs; owners among them."],
  ["Catering", "owner", "value", "Event caterers chasing local B2B."],
  ["Bakery", "owner", "value", "Small bakeries, very local."],
  ["cafe", "owner", "value", "Cafe owners, footfall and Maps driven."],
  ["bars", "owner", "no", "Bar owners; events and social reach."],
  ["eventplanning", "owner", "value", "Planners chasing enquiries."],
  ["videography", "owner", "value", "Freelancers and studios needing bookings."],
  ["DJs", "owner", "value", "Event DJs marketing locally."],
  ["Dogtraining", "owner", "no", "Owners and trainers mixed; trainers need clients."],
  ["doggrooming", "owner", "value", "Groomers; appointment-led and very local."],
  ["Veterinarians", "owner", "no", "Second vet room, owner-heavy."],
  ["MartialArts", "owner", "no", "School owners filling classes."],
  ["Tutoring", "owner", "value", "Tutors and small centres chasing enrolments."],
  ["Daycares", "owner", "value", "Centres with waiting lists or empty rooms."],
  ["fitnessbusiness", "owner", "value", "Gym and studio owners specifically about the business."],

  // --- B2B and tech services ---
  ["sysadmin", "owner", "no", "IT professionals; MSP owners among them."],
  ["ITManagers", "owner", "no", "Buyers of IT services, not marketing."],
  ["recruiting", "owner", "value", "Recruiters who market to get clients."],
  ["humanresources", "biz", "no", "HR professionals; not our buyer."],
  ["staffing", "owner", "value", "Staffing agency owners chasing clients."],
  ["consulting", "biz", "value", "Consultants with a lead problem of their own."],
  ["freelance", "biz", "no", "Freelancers, not buyers. Credibility only."],
  ["Emailmarketingtips", "ads", "value", "Small practical email room."],
  ["startups", "biz", "no", "Founder discussion; promo removed."],
  ["indiehackers", "biz", "value", "Builders who market their own products."],
  ["SideProject", "biz", "value", "Launch room; reach more than leads."],
  ["roastmystartup", "biz", "ok", "Critique is the point — free teardowns belong here."],
  ["analyticsengineering", "ads", "no", "Data side; credibility only."],
  ["BusinessIntelligence", "biz", "no", "Not our buyer, kept for completeness."],
  ["smallbusinessadvice", "biz", "value", "Owners asking for help directly."],
  ["ecommercemarketing", "ads", "value", "Store marketing specifically."],
  ["Slavelabour", "biz", "ok", "Offers allowed but the budgets are tiny. Karma only."],
  ["hiring", "biz", "ok", "Direct hiring posts, mixed quality."],
  ["jobbit", "biz", "ok", "Small gig board, low ticket."],
];
for (const [sub, kind, promo, note] of V2.MORE_TARGETS) {
  if (!V2.TARGETS.some((t) => t.sub.toLowerCase() === sub.toLowerCase())) V2.TARGETS.push({ sub, kind, promo, note });
}

V2.KINDS = [
  { key: "ads", name: "Already spending", why: "They have a budget and a complaint. Shortest path to a paying client." },
  { key: "owner", name: "Business owners", why: "No marketing team, no agency, pays for calls. Best ticket size." },
  { key: "biz", name: "General business", why: "Big rooms. Reach and credibility more than direct leads." },
];
V2.PROMO = {
  no: { name: "Comments only", rank: 0, why: "Offers get removed here. Answer questions, build the name, they DM you." },
  weekly: { name: "Weekly thread", rank: 1, why: "Offers belong in the sub's own promo thread — still works, less reach." },
  value: { name: "Value post ok", rank: 2, why: "A post is welcome if it gives something away before it asks." },
  ok: { name: "Offers ok", rank: 3, why: "Straight offers are allowed." },
};
V2.targetsBy = function (kind) { return V2.TARGETS.filter((t) => !kind || kind === "all" || t.kind === kind); };
V2.postable = function (t) { return (V2.PROMO[t.promo] || {}).rank >= 1; };

// ----------------------------------------------------------------- offers
// An offer is irresistible when the risk sits on us, the value arrives
// before the invoice, and the ask is smaller than the gift. Every one of
// these gives something real away first. `ask` is the only thing we want
// back, and it is never "book a call" on the first touch.
V2.OFFERS = [
  { key: "gbp_audit", posture: "free", name: "Free Google Business Profile audit", channel: "local_seo",
    who: "any business with a physical location or a service area",
    gift: "where you rank for your main keyword, the three profiles sitting above you, what they have that you do not, and the two things I would fix first",
    ask: "drop your Maps link or business name and city",
    risk: "posted publicly in the thread — there is nothing to fill in and nobody rings you",
    spots: 10 },
  { key: "ads_teardown", posture: "free", name: "Free ad account teardown", channel: "meta_ads",
    who: "anyone spending over $1,000 a month on Meta or Google",
    gift: "a walk through your structure, your worst-spending ad set, and the three changes I would make on Monday",
    ask: "share a screenshot of your last 30 days with the account name blurred",
    risk: "I post the teardown in the thread so everyone learns from it",
    spots: 5 },
  { key: "local_pack", posture: "free", name: "Free local pack report", channel: "local_seo",
    who: "local service businesses fighting for map positions",
    gift: "a grid of where you actually rank across your city, not just from your own office chair, plus who owns the squares you are losing",
    ask: "business name and city",
    risk: "the report is yours whether or not we ever speak again",
    spots: 10 },
  { key: "free_build", posture: "guaranteed", name: "We build it free, you only pay the ad spend", channel: "meta_ads",
    who: "businesses that have never run paid ads properly",
    gift: "campaign build, audience, tracking and the first creative set at no cost — you pay the platform, not us",
    ask: "tell me the business and what a new customer is worth to you",
    risk: "if month one does not beat what you are doing now, we stop and you owe nothing",
    spots: 3 },
  { key: "pay_on_results", posture: "results", name: "Pay per booked lead, no retainer", channel: "google_ads_seo",
    who: "owners burned by a monthly retainer that produced nothing",
    gift: "we carry the setup and the management cost",
    ask: "agree a price per booked call before we start",
    risk: "no lead, no invoice",
    spots: 3 },
  { key: "creative_pack", posture: "swap", name: "10 ad creatives for one case study", channel: "instagram_tiktok",
    who: "brands whose ads have gone stale",
    gift: "ten scroll-stopping IG and TikTok concepts scripted and edited for your product, yours to keep and run",
    ask: "if one of them wins, let us write it up as a named case study",
    risk: "no cash either way — you owe a case study only if the numbers move, and nothing at all if they do not",
    spots: 5 },
  { key: "landing_fix", posture: "credited", name: "Paid page teardown, credited if we build it", channel: "google_ads_seo",
    who: "anyone sending paid traffic to a page that does not convert",
    gift: "a line-by-line teardown of the page your ads point at, the rewrite we would ship first, and the numbers we would expect from it",
    ask: "post the URL and pay the small teardown fee",
    risk: "the fee is small on purpose and it comes off the first invoice if you ask us to build the page — so it costs nothing if you go ahead, and you keep the document if you do not",
    spots: 10 },
  { key: "seo_gap", posture: "swap", name: "Keyword gap report for an honest review", channel: "google_ads_seo",
    who: "businesses being out-ranked and not sure why",
    gift: "every search your top competitor ranks for that you do not, sorted by what those searches are worth to you",
    ask: "read it, then leave an honest public review of the report itself — good or bad",
    risk: "no cash either way, and the review is yours to write however you found it",
    spots: 10 },
  { key: "dead_leads", posture: "results", name: "We work your dead lead list free", channel: "meta_ads",
    who: "anyone sitting on months of old enquiries that went cold",
    gift: "we write and run the reactivation sequence over your existing list",
    ask: "export the list",
    risk: "you pay per job booked out of it and nothing at all for the work itself — no job, no invoice",
    spots: 3 },
  { key: "90_day_plan", posture: "free", name: "Free 90-day growth plan, written, no call", channel: "none",
    who: "owners who want the plan without being sold to",
    gift: "a written 90-day plan for your business — channels, budget split, what to do in which week",
    ask: "three lines about the business and the goal",
    risk: "no call required, ever — I send the document and you do what you like with it",
    spots: 5 },
];
V2.POOL = [];    // offers written in the studio, merged in at runtime
V2.allOffers = function () { return V2.OFFERS.concat(V2.POOL); };
V2.offer = function (key) { return V2.allOffers().find((o) => o.key === key) || V2.OFFERS[0]; };

// ------------------------------------------------------------ offer studio
// Type what you do, what you have proof of, who you want, and get ten offers
// back. The ten shipped above are a starting bench, not the limit — the ones
// that actually convert will be the ones written around your own numbers.
V2.OFFER_ANGLES = [
  { key: "audit", name: "The free audit", how: "give away the diagnosis in public" },
  { key: "teardown", name: "The teardown", how: "pull their own account or page apart, free" },
  { key: "done_free", name: "We do it, you pay nothing yet", how: "carry the setup cost ourselves" },
  { key: "performance", name: "Pay only on results", how: "no retainer, a price per booked outcome" },
  { key: "guarantee", name: "The guarantee", how: "a named number by a named date or it is free" },
  { key: "asset", name: "Give the asset away", how: "hand over the file, sheet or creatives to keep" },
  { key: "speed", name: "The speed offer", how: "a small, complete thing finished in days, not months" },
  { key: "risk_split", name: "Split the risk", how: "we take a smaller fee up front and more only if it works" },
  { key: "comparison", name: "Beat what they have", how: "run against their current setup and let the numbers decide" },
  { key: "unbundle", name: "The one-piece offer", how: "sell the single piece that unblocks them, not a package" },
];
// Not everything has to be free. "Free" is one posture out of five, and it is
// the weakest one in a room full of people who have been burned by a free
// audit that turned into a sales call. The others put money in the picture
// and take the risk anyway, which is a different and often stronger promise.
V2.POSTURES = [
  { key: "free", name: "Free up front", money: false,
    how: "they get the thing for nothing and owe nothing. Strong for a first touch in a cold room, weak where people have seen ten fake free audits." },
  { key: "guaranteed", name: "Paid, with a guarantee", money: true,
    how: "they pay, and if a named result does not arrive by a named date they get it back. Attracts people who distrust free things." },
  { key: "results", name: "Pay only on the result", money: true,
    how: "no retainer. A price per booked call, per job, per sale. The strongest posture for owners burned by a monthly fee." },
  { key: "credited", name: "Small fee, credited back", money: true,
    how: "a real but small charge for the diagnosis, taken off the first invoice if they go ahead. Filters out tyre-kickers without filtering out buyers." },
  { key: "swap", name: "A swap, not a sale", money: false,
    how: "the work in exchange for something they already have — a review, a filmed testimonial, a named case study, an introduction. No cash either way." },
];
V2.posture = function (k) { return V2.POSTURES.find((p) => p.key === k) || V2.POSTURES[0]; };

V2.OFFER_SCHEMA = {
  type: "object",
  properties: {
    offers: {
      type: "array",
      description: "Ten offers, each built on a different angle.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "What the offer is called, in plain words. No brand name, no prices." },
          angle: { type: "string", description: "Which angle it uses." },
          who: { type: "string", description: "Exactly who it is for. A trade and a situation, not 'small businesses'." },
          gift: { type: "string", description: "What they receive for free, concretely. A thing, not a feeling." },
          ask: { type: "string", description: "The single smallest thing we ask back. Never a call, never an email address." },
          risk: { type: "string", description: "Why it costs them nothing to say yes." },
          spots: { type: "integer", description: "How many we will do, between 3 and 15." },
          channel: { type: "string", description: "One of local_seo, google_ads_seo, meta_ads, instagram_tiktok, none." },
          why_it_works: { type: "string", description: "One line on why this one is hard to refuse." },
          posture: { type: "string", description: "One of free, guaranteed, results, credited, swap." },
        },
        required: ["name", "angle", "who", "gift", "ask", "risk", "spots", "channel", "why_it_works", "posture"],
        additionalProperties: false,
      },
    },
  },
  required: ["offers"],
  additionalProperties: false,
};
V2.offerSystem = function (profile = {}) {
  return [
    "You write offers for " + (profile.name || "a small paid-ads and local-search team") + (profile.place ? " in " + profile.place : "") + ".",
    "",
    "An offer is irresistible when two things are true: the risk sits on us rather than on them, and the thing we ask back is smaller than the thing we give. It does not have to be free — free is only one of five postures, and in a room full of people who have been burned by a free audit that became a sales call, it is often the weakest.",
    "",
    "The five postures. Spread the ten across all of them; no more than three may be free:",
    ...V2.POSTURES.map((p) => "- " + p.name + ": " + p.how),
    "",
    "Rules for every offer you write:",
    "- The gift must be a concrete deliverable a stranger can picture. 'Where you rank for your main keyword and the three profiles above you' is an offer. 'A free consultation' is not.",
    "- The ask must be one small public thing: a link, a business name, a screenshot. Never a call, never an email address, never a form.",
    "- A free or swap offer names no money at all. A guaranteed, results or credited offer must be explicit about what is paid and what happens if it does not work — that honesty is the whole appeal.",
    "- No packages, no discounts, no 'limited time'. Scarcity is a number of spots, nothing else.",
    "- No brand name, no domain, no agency language.",
    "- Each of the ten must use a different angle. Do not write the same offer ten ways.",
    "- Aim them at people who already have money moving: a business with customers, a budget, or an agency they are unhappy with.",
    "",
    "The angles to use, one each:",
    ...V2.OFFER_ANGLES.map((a) => "- " + a.name + ": " + a.how),
  ].join("\n");
};
V2.offerUser = function (brief, profile = {}) {
  return [
    "What we do and what we can prove, in their own words:",
    String(brief || "").slice(0, 4000),
    profile.credit ? "\nOther true things about us: " + profile.credit : "",
    profile.wins ? "\nReal results we can cite: " + profile.wins : "",
    "\nWrite ten offers.",
  ].filter(Boolean).join("\n");
};
V2.offerChecks = function (o) {
  const bad = [];
  const p = V2.posture(o && o.posture);
  const all = [o && o.name, o && o.gift, o && o.ask, o && o.risk].join(" ");
  if (!o || !o.name || o.name.length < 6) bad.push("it has no real name");
  if (!o.gift || o.gift.length < 25) bad.push("the free part is too vague to picture");
  if (!o.ask || o.ask.length < 8) bad.push("there is no ask");
  if (!o.risk || o.risk.length < 12) bad.push("it does not say why saying yes is safe");
  if (/book a call|hop on a call|schedule a call|jump on a call|free consultation|discovery call/i.test(all)) bad.push("it asks for a call, which is not a small ask");
  if (/email address|your email|sign ?up|fill (in|out) (the|a) form/i.test(all)) bad.push("it asks for an email or a form");
  if (/https?:\/\/|www\./i.test(all)) bad.push("it contains a link");
  if (/\bpackage|\bdiscount|\b\d+% off|limited time/i.test(all)) bad.push("it talks in packages or discounts");
  // money is allowed, and required, only where the posture puts it there
  const money = /\$\s?\d|\bpay\b|\bpaid\b|\bfee\b|\binvoice\b|\bcharge/i.test(all);
  if (!p.money && /\$\s?\d/.test(all)) bad.push("a " + p.name.toLowerCase() + " offer should not name a price");
  if (p.money && !money) bad.push("a " + p.name.toLowerCase() + " offer has to say what is paid — that honesty is the appeal");
  if (p.key === "guaranteed" && !/(back|refund|free|nothing|no charge)/i.test(String(o.risk || ""))) bad.push("a guarantee must say what happens when the result does not arrive");
  if (p.key === "results" && !/\bper\b|\bonly (when|if)\b|\bno (lead|job|sale|call).*no\b/i.test(all)) bad.push("a pay-on-results offer must say what triggers payment");
  if (p.key === "credited" && !/credit|taken off|deducted|comes off|knocked off/i.test(all)) bad.push("a credited offer must say the fee comes off the first invoice");
  if (p.key === "swap" && !/review|testimonial|case study|introduction|intro\b|footage|photos|referral/i.test(all)) bad.push("a swap must name what they give instead of money");
  const spots = Number(o.spots || 0);
  if (!(spots >= 3 && spots <= 15)) bad.push("the number of spots is not believable");
  return bad;
};
// A batch of offers that is all one posture is a batch of one idea.
V2.offerSpread = function (list) {
  const seen = {};
  for (const o of list || []) seen[V2.posture(o.posture).key] = (seen[V2.posture(o.posture).key] || 0) + 1;
  const kinds = Object.keys(seen).length;
  const free = seen.free || 0;
  return { kinds, free, counts: seen, ok: kinds >= 3 && free <= Math.ceil((list || []).length / 2),
    why: kinds < 3 ? "they are all the same kind of offer" : free > Math.ceil((list || []).length / 2) ? "too many of them are simply free" : "a real spread" };
};

V2.offerFromDraft = function (d, i) {
  return {
    key: "made_" + Date.now().toString(36) + "_" + i,
    name: String(d.name || "").slice(0, 90),
    angle: String(d.angle || ""),
    who: String(d.who || ""), gift: String(d.gift || ""), ask: String(d.ask || ""), risk: String(d.risk || ""),
    spots: Math.max(3, Math.min(15, Number(d.spots) || 10)),
    channel: ["local_seo", "google_ads_seo", "meta_ads", "instagram_tiktok", "none"].includes(d.channel) ? d.channel : "none",
    why: String(d.why_it_works || ""),
    posture: V2.POSTURES.some((x) => x.key === d.posture) ? d.posture : "free",
    fitHere: String(d.fit_here || ""),
    made: true, at: Date.now(),
  };
};

// ------------------------------------------- five offers for one room
// A general offer is a guess. An offer written for r/Roofing knows that its
// readers price by the job, argue about lead sellers, and have watched three
// agencies come and go — and an offer for a comments-only room has to be
// deliverable inside a comment under somebody else's thread, because there
// will never be a post.
V2.ROOM_OFFER_SCHEMA = {
  type: "object",
  properties: {
    offers: {
      type: "array",
      description: "Five offers for this one subreddit, on five different postures.",
      items: V2.OFFER_SCHEMA.properties.offers.items,
    },
    room_read: { type: "string", description: "One line on what these particular people are actually worried about." },
  },
  required: ["offers", "room_read"],
  additionalProperties: false,
};
// the per-room items need one extra field
V2.ROOM_OFFER_SCHEMA.properties.offers.items = {
  ...V2.OFFER_SCHEMA.properties.offers.items,
  properties: {
    ...V2.OFFER_SCHEMA.properties.offers.items.properties,
    fit_here: { type: "string", description: "Why this one suits this subreddit in particular, not business owners in general." },
  },
  required: [...V2.OFFER_SCHEMA.properties.offers.items.required, "fit_here"],
};

V2.roomOfferSystem = function (profile = {}) {
  return [
    "You write offers for " + (profile.name || "a small paid-ads and local-search team") + (profile.place ? " in " + profile.place : "") + ", aimed at one subreddit at a time.",
    "",
    "An offer is irresistible when the risk sits on us and the thing we ask back is smaller than the thing we give. It does not have to be free.",
    "",
    "Write exactly five, one on each posture:",
    ...V2.POSTURES.map((p) => "- " + p.name + ": " + p.how),
    "",
    "Every one must be unmistakably about this room's trade. Use the words those people use for their own work, their own unit of money — a job, a case, a patient, a cover, a booking — and the specific thing that goes wrong for them. An offer that would read the same in any other subreddit has failed.",
    "",
    "Rules:",
    "- The gift is a concrete deliverable a stranger can picture.",
    "- The ask is one small public thing: a link, a business name, a screenshot. Never a call, never an email, never a form.",
    "- Free and swap offers name no money. Guaranteed, results and credited offers must be explicit about what is paid and what happens if it does not work.",
    "- No packages, no discounts, no 'limited time'. Scarcity is a number of spots.",
    "- No brand name, no domain, no agency language, no links.",
  ].join("\n");
};
V2.roomOfferUser = function (target, campaign, profile = {}, opts = {}) {
  const t = typeof target === "string" ? (V2.TARGETS.find((x) => x.sub === target) || { sub: target, kind: "biz", promo: "value", note: "" }) : target;
  const promo = V2.PROMO[t.promo] || V2.PROMO.value;
  const lines = [
    "Room: r/" + t.sub,
    "What it is: " + (t.note || "a business subreddit"),
    "Who is in it: " + (t.kind === "ads" ? "people already spending money on advertising, and complaining about it" : t.kind === "owner" ? "owners of one business, with no marketing team" : "business owners of every kind"),
    "What it allows: " + promo.name + " — " + promo.why,
  ];
  if (opts.members) lines.push("Size: " + opts.members.toLocaleString() + " members" + (opts.online ? ", " + opts.online.toLocaleString() + " online right now" : ""));
  if (opts.rules && opts.rules.length) lines.push("Its rules: " + opts.rules.slice(0, 8).map((r) => r.name || r.short_name).filter(Boolean).join("; "));
  if (promo.rank < 1) lines.push("", "This room never allows an offer post. Every one of these five has to work as a comment underneath somebody else's thread — short enough to type into a reply, and offered to one person rather than announced to the room.");
  if (campaign) lines.push("", "The campaign this belongs to: " + campaign.niche + ". " + campaign.why);
  if (profile.credit) lines.push("", "True things about us: " + profile.credit);
  if (profile.wins) lines.push("Real results we can cite: " + profile.wins);
  if (opts.extra) lines.push("", "Extra instruction: " + opts.extra);
  lines.push("", "Write the five.");
  return lines.join("\n");
};

// ------------------------------------------------------------- improving
// One offer, made stronger, with the reason it changed. The note is yours:
// "make it paid", "aim it higher", "too much like a free audit".
V2.IMPROVE_SCHEMA = {
  type: "object",
  properties: {
    offer: V2.ROOM_OFFER_SCHEMA.properties.offers.items,
    changed: { type: "string", description: "What you changed and why, in one or two sentences." },
    weakness: { type: "string", description: "The weakest thing still left in it." },
  },
  required: ["offer", "changed", "weakness"],
  additionalProperties: false,
};
V2.improveSystem = function (profile = {}) {
  return [
    V2.roomOfferSystem(profile),
    "",
    "This time you are given one existing offer and asked to make it stronger. Keep whatever already works. Change what does not.",
    "The usual weaknesses, in order of how often they are the problem:",
    "- the gift is a category rather than a thing ('an audit' instead of what the audit contains)",
    "- the ask is too big, so nobody starts",
    "- the risk is not really on us, it only sounds like it is",
    "- it would read identically in any other subreddit",
    "- it is free when a paid posture would be believed more",
    "Return one offer, not five.",
  ].join("\n");
};
V2.improveUser = function (offer, note, target, profile = {}) {
  const lines = ["The offer as it stands:",
    "Name: " + (offer.name || ""), "Posture: " + V2.posture(offer.posture).name,
    "Who: " + (offer.who || ""), "They get: " + (offer.gift || ""),
    "We ask: " + (offer.ask || ""), "Their risk: " + (offer.risk || ""),
    "Spots: " + (offer.spots || 10)];
  const issues = V2.offerChecks(offer);
  if (issues.length) lines.push("", "It currently fails these checks, fix every one: " + issues.join("; "));
  // String.prototype.sub is a real (deprecated) method, so a bare string here
  // would print a function rather than the subreddit name
  const sub = typeof target === "string" ? target : (target && target.sub) || "";
  if (sub) lines.push("", "It is for r/" + sub + ".");
  if (note) lines.push("", "What to change, in their words: " + note);
  else lines.push("", "No instruction was given, so make your own judgement about what is weakest.");
  if (profile.wins) lines.push("", "Real results we can cite: " + profile.wins);
  lines.push("", "Rewrite it.");
  return lines.join("\n");
};

// -------------------------------------------------------------- post types
// `magnet` posts ask for something back in the comments. `value` posts ask
// for nothing — they exist so that the name behind the magnet posts is worth
// answering. A board that only runs magnets reads as spam within a fortnight.
V2.POST_TYPES = [
  { key: "audit_magnet", name: "Free audit magnet", magnet: true,
    shape: "Offer the audit, say how many spots, say exactly what they get, ask them to drop the one thing you need in the comments. Do the audits publicly in the thread." },
  { key: "result_story", name: "Result story", magnet: false,
    shape: "One client, real numbers, the whole method given away step by step, including what failed. No offer at the end — a question instead." },
  { key: "teardown", name: "Public teardown", magnet: false,
    shape: "Take one anonymised account or profile and pull it apart in public. Show the fix. Invite others to post theirs." },
  { key: "playbook", name: "Playbook", magnet: false,
    shape: "The full step-by-step of something you do for money, written so a reader could do it alone this weekend." },
  { key: "mistakes", name: "Mistakes list", magnet: false,
    shape: "Five things you keep seeing this industry get wrong, each with the fix and what it cost someone." },
  { key: "comparison", name: "Channel comparison", magnet: false,
    shape: "Two channels compared with your own numbers across several accounts. Say which loses and why." },
  { key: "giveaway", name: "Template giveaway", magnet: true,
    shape: "Give away the sheet, checklist or script itself, pasted into the post so nobody has to leave Reddit. Ask for nothing but a comment on what they would add." },
  { key: "question_ask", name: "Real question", magnet: false,
    shape: "Ask the room a genuine question you want the answer to. Buyers reveal themselves in the replies." },
  { key: "ama", name: "AMA", magnet: true,
    shape: "Say who you are, what you run, the unusual thing you know, and open the floor. Answer every single comment." },
  { key: "local_case", name: "Local case", magnet: false,
    shape: "A story rooted in one city and one trade, with the local search detail that only someone who did the work would know." },
];
V2.postType = function (key) { return V2.POST_TYPES.find((t) => t.key === key) || V2.POST_TYPES[0]; };

// ------------------------------------------------------------ the writing
V2.POST_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "The post title. Plain, specific, no emoji, no clickbait, under 140 characters." },
    body: { type: "string", description: "The post body in Reddit markdown. No links of any kind. No prices. No agency name." },
    first_comment: { type: "string", description: "The comment to leave on your own post a minute after posting: the extra detail that did not fit, ending in a question." },
    why_this_sub: { type: "string", description: "One line on why this room in particular will take this post well." },
    risk: { type: "string", description: "The most likely reason a moderator would remove this, or 'none'." },
  },
  required: ["title", "body", "first_comment", "why_this_sub", "risk"],
  additionalProperties: false,
};

V2.postSystem = function (profile = {}) {
  const me = profile.name || "a small marketing team";
  const where = profile.place || "";
  return [
    "You write Reddit posts for " + me + (where ? ", based in " + where : "") + ". They run paid ads and local search for small businesses.",
    "",
    "The single rule: the post must be worth reading by someone who will never hire anybody. Reddit removes posts that read as advertising, and readers downvote them long before a moderator arrives.",
    "",
    "Hard constraints:",
    "- No links, no URLs, no domain names, no email addresses. Nothing that could be a funnel.",
    "- No agency name, no brand name, no 'we are a full-service agency'.",
    "- No prices, no packages, no 'starting at'.",
    "- No emoji. No bold-everything. No em-dash-heavy corporate rhythm.",
    "- Never say 'in today's digital landscape', 'leverage', 'unlock', 'game-changer', 'delve', 'elevate your'.",
    "- Write like a person typing on a phone who knows the trade: short sentences, concrete numbers, one admission of something that went wrong.",
    "- Specifics beat adjectives. '12 calls to 61 calls in four months' beats 'incredible results'.",
    "- The post must end with a question to the room.",
    "",
    "Formatting: Reddit markdown. Short paragraphs. Numbered lists where there are steps. No headers larger than bold text.",
  ].join("\n");
};

V2.postUser = function (target, offer, type, profile = {}, extra = "", opts = {}) {
  const t = V2.postType(type.key ? type.key : type);
  const o = V2.offer(offer.key ? offer.key : offer);
  const tg = typeof target === "string" ? (V2.TARGETS.find((x) => x.sub === target) || { sub: target, kind: "biz", promo: "value", note: "" }) : target;
  const promo = V2.PROMO[tg.promo] || V2.PROMO.value;
  const lines = [
    "Room: r/" + tg.sub,
    "What that room is: " + (tg.note || "a business subreddit"),
    "What that room allows: " + promo.name + " — " + promo.why,
    "",
    "Post type: " + t.name,
    "Shape: " + t.shape,
    "",
  ];
  if (t.magnet) {
    lines.push(
      "The offer to make: " + o.name,
      "Who it is for: " + o.who,
      "What they get free: " + o.gift,
      "What we ask for: " + o.ask,
      "Why it is safe for them: " + o.risk,
      "Spots: " + o.spots,
      "",
      "Make the offer the point of the post. State the number of spots. Say plainly that the work will be posted back in this thread in public. Ask them to comment, never to DM.",
      ""
    );
  } else {
    lines.push(
      "This post makes no offer at all. Nothing is sold. The subject should sit next to this work so that the people it attracts are the same people who would buy it later: " + o.name.toLowerCase() + " — " + o.who + ".",
      "Give the method away completely. If a reader could do it themselves after reading, the post is correct.",
      ""
    );
  }
  if (opts && opts.shape) lines.push(V2.shapeBlock(opts.shape), "");
  if (profile.credit) lines.push("True things about us that may be used, in our own words, and only if they fit naturally: " + profile.credit, "");
  if (profile.wins) lines.push("Real results we can cite: " + profile.wins, "");
  if (extra) lines.push("Extra instruction for this one: " + extra, "");
  lines.push("Write the post.");
  return lines.join("\n");
};

// The gate every draft passes before it is allowed onto the board. Anything
// that fails here would have been removed by a moderator or ignored by the
// room, so it is cheaper to catch it now.
V2.AI_TELLS = ["in today's digital landscape", "leverage", "unlock the", "game-changer", "game changer", "delve", "elevate your", "in conclusion", "furthermore", "it's important to note", "as an ai"];
V2.postChecks = function (draft, target, type) {
  const t = V2.postType(type && type.key ? type.key : type);
  const title = String((draft && draft.title) || "");
  const body = String((draft && draft.body) || "");
  const all = (title + "\n" + body).toLowerCase();
  const bad = [];
  if (title.length < 15) bad.push("the title is too short");
  if (title.length > 300) bad.push("Reddit cuts titles at 300 characters");
  if (title === title.toUpperCase() && /[A-Z]{6}/.test(title)) bad.push("the title is shouting");
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(title + body)) bad.push("there is an emoji in it");
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|agency|marketing)\b/i.test(body)) bad.push("there is a link or a domain name in the body");
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(body)) bad.push("there is an email address in it");
  if (/\bstarting at\b|\bper month we charge\b|\bour (packages|pricing|rates)\b/i.test(body)) bad.push("it quotes a price");
  if (body.length < (t.magnet ? 320 : 700)) bad.push("the body is too thin for " + t.name.toLowerCase() + " (" + body.length + " characters)");
  if (body.length > 9000) bad.push("the body is longer than Reddit will take comfortably");
  if (!/\?\s*$/.test(body.trim())) bad.push("it does not end on a question");
  const tell = V2.AI_TELLS.find((w) => all.includes(w));
  if (tell) bad.push('it contains "' + tell + '", which reads as machine-written');
  if (t.magnet) {
    if (/\bdm me\b|\bpm me\b|\bsend me a (dm|pm)\b/i.test(body)) bad.push("it asks for a DM — the ask must be a public comment");
    if (!/\bcomment|\bdrop\b|\breply\b|\bpost (it|your|below)\b/i.test(body)) bad.push("it never asks them to comment");
  } else {
    if (/\bdm me\b|\bpm me\b|\bhire\b.*\bus\b|\bwe offer\b|\bour service\b/i.test(body)) bad.push("a value post must not pitch");
  }
  return bad;
};

// --------------------------------------------------------------- calendar
// One post a day, and the board decides which room, which offer and which
// shape so that nothing repeats in a pattern a moderator would notice.
// Deterministic: the same inputs always produce the same calendar, so
// re-planning after a change does not shuffle everything you already sent.
// Three posts a day, in three different rooms, in three different shapes, so
// that by the end of a fortnight you can see which room type and which shape
// actually produced comments — not just that "Reddit worked" or it didn't.
//
// Lane 1 carries the offer, but only on its cadence; on the days in between
// it carries proof instead, so the slot is never wasted and the account never
// looks like a billboard. Lanes 2 and 3 never sell anything.
V2.LANES = [
  { key: "offer", name: "Offer", hour: 9, magnetTypes: ["audit_magnet", "giveaway", "ama"], restTypes: ["result_story", "local_case"],
    why: "the ask. Runs on its own cadence so the account is not one long advert." },
  { key: "proof", name: "Proof", hour: 14, restTypes: ["result_story", "teardown", "comparison", "local_case"],
    why: "numbers and method, given away. This is what makes the offer days believable." },
  { key: "talk", name: "Conversation", hour: 19, restTypes: ["question_ask", "mistakes", "playbook"],
    why: "a question or a list that starts an argument. Buyers reveal themselves in the replies." },
];
V2.KIND_ORDER = ["owner", "ads", "biz"];
V2.PLAN_DEFAULT = { days: 30, perDay: 3, subCoolDays: 14, magnetEvery: 2, kinds: "all", commentsPerPost: 5 };

V2.plan = function (opts = {}) {
  const o = { ...V2.PLAN_DEFAULT, ...opts };
  const start = o.start || Date.now();
  const chosen = (o.subs && o.subs.length) ? o.subs.map((x) => V2.TARGETS.find((t) => t.sub === x)).filter(Boolean) : V2.targetsBy(o.kinds);
  const pool = chosen.filter(V2.postable);
  if (!pool.length) return { rows: [], error: "no room in the list allows a post — pick some subreddits that are not comments-only" };
  const offers = (o.offers && o.offers.length ? o.offers : V2.allOffers().map((x) => x.key)).map(V2.offer);
  const lanes = V2.LANES.slice(0, Math.max(1, Math.min(V2.LANES.length, o.perDay)));
  const allow = (keys) => keys.filter((k) => !o.types || !o.types.length || o.types.includes(k)).map(V2.postType);

  // by kind, so each of the day's slots can come from a different group and
  // the three groups can be compared against each other later
  const byKind = {};
  for (const k of V2.KIND_ORDER) byKind[k] = pool.filter((t) => t.kind === k);
  const cursor = { owner: 0, ads: 0, biz: 0, any: 0 };
  const last = {};
  for (const h of o.history || []) if (h.sub) last[h.sub] = Math.max(last[h.sub] || 0, h.at || 0);

  const takeRoom = (kind, at, needsOffer, usedToday) => {
    const tries = [];
    if (byKind[kind] && byKind[kind].length) tries.push([kind, byKind[kind]]);
    for (const k of V2.KIND_ORDER) if (k !== kind && byKind[k] && byKind[k].length) tries.push([k, byKind[k]]);
    tries.push(["any", pool]);
    for (const [ck, list] of tries) {
      for (let i = 0; i < list.length; i += 1) {
        const c = list[(cursor[ck] + i) % list.length];
        if (usedToday.has(c.sub)) continue;
        if (needsOffer && ((V2.PROMO[c.promo] || {}).rank || 0) < 1) continue;
        if ((last[c.sub] || 0) > at - o.subCoolDays * 86400000) continue;
        cursor[ck] = (cursor[ck] + i + 1) % list.length;
        return { room: c, borrowed: ck !== kind && ck !== "any" ? ck : (ck === "any" ? "any" : "") };
      }
    }
    return null;
  };

  const rows = [];
  let n = 0, magnetN = 0;
  const laneN = {};                     // each lane walks its own shapes, so
                                        // two slots on one day never rhyme
  const days = Math.max(1, o.days);
  for (let d = 0; d < days; d += 1) {
    const dayStart = start + d * 86400000;
    const usedToday = new Set();
    const shapesToday = new Set();
    for (let li = 0; li < lanes.length; li += 1) {
      const lane = lanes[li];
      n += 1;
      const at = new Date(dayStart); at.setHours(lane.hour, 0, 0, 0);
      const wantMagnet = lane.key === "offer" && (d % Math.max(1, o.magnetEvery) === 0);
      const types = wantMagnet ? allow(lane.magnetTypes || []) : allow(lane.restTypes || []);
      const lk = lane.key + (wantMagnet ? ":offer" : ":rest");
      laneN[lk] = (laneN[lk] || 0);
      // skip past a shape another lane already used today, so the three posts
      // never read like the same post three times
      let type = types.length ? types[laneN[lk] % types.length] : V2.postType("result_story");
      for (let t = 1; t < types.length && shapesToday.has(type.key); t += 1) type = types[(laneN[lk] + t) % types.length];
      laneN[lk] += 1;
      shapesToday.add(type.key);
      // the three slots walk the three groups, and the pairing shifts each day
      // so a shape is never permanently married to one kind of room
      const kind = V2.KIND_ORDER[(li + d) % V2.KIND_ORDER.length];
      const got = takeRoom(kind, at.getTime(), !!type.magnet, usedToday);
      if (!got) { rows.push({ n, day: d + 1, lane: lane.key, laneName: lane.name, at: at.getTime(), skipped: true, why: "no room left that has cooled down — widen the room list or shorten the gap" }); continue; }
      const room = got.room;
      usedToday.add(room.sub);
      last[room.sub] = at.getTime();
      if (type.magnet) magnetN += 1;
      const offer = type.magnet ? offers[(magnetN - 1) % offers.length] : offers[(n - 1) % offers.length];
      rows.push({
        n, day: d + 1, lane: lane.key, laneName: lane.name, at: at.getTime(),
        sub: room.sub, kind: room.kind, promo: room.promo, weekly: room.promo === "weekly",
        group: room.kind, borrowed: got.borrowed || "",
        typeKey: type.key, typeName: type.name, magnet: !!type.magnet,
        offerKey: offer.key, offerName: offer.name,
        why: type.magnet
          ? "offer slot — " + offer.name.toLowerCase() + " into r/" + room.sub + (room.promo === "weekly" ? ", inside that sub's weekly promo thread" : "")
          : lane.name.toLowerCase() + " slot — " + type.name.toLowerCase() + " into r/" + room.sub + ", nothing sold",
        state: "planned",
      });
    }
  }
  const real = rows.filter((r) => r.sub);
  const groups = {};
  for (const r of real) groups[r.group] = (groups[r.group] || 0) + 1;
  return {
    rows, magnets: real.filter((r) => r.magnet).length, values: real.filter((r) => !r.magnet).length,
    skipped: rows.filter((r) => r.skipped).length, rooms: new Set(real.map((r) => r.sub)).size,
    perDay: lanes.length, groups, commentsPerPost: o.commentsPerPost,
    comments: real.length * (o.commentsPerPost || 0),
  };
};

// Reddit publishes each room's rules as JSON. Reading them beats guessing:
// the tool downgrades a room to comments-only the moment its own rules say
// no self-promotion, whatever we wrote in the list.
V2.NO_PROMO_RE = /no (self[- ]?promo|promotion|advertis|soliciting|spam)|self[- ]?promo(tion)? (is )?(not allowed|prohibited|banned|forbidden)|do not (advertise|promote|solicit)|no ads\b|advertising is not allowed|not a place to (advertise|promote)|banned: ?(promo|advertis)|no (marketing |digital )?(agenc|vendor|solicit)|(agenc|vendor)(y|ies|s)? (are )?(not allowed|prohibited|banned|may not)|approved vendors only|(only )?approved vendors|vendor(s)? must be approved/i;
V2.WEEKLY_RE = /(weekly|monthly|sticky|pinned|megathread|designated) (self[- ]?promo|promo|advertis|thread)|promo(tion)? thread|self[- ]?promo(tion)? (thread|saturday|sunday|monday)|only in the (weekly|monthly|sticky|pinned)/i;
V2.OK_PROMO_RE = /self[- ]?promo(tion)? (is )?(allowed|welcome|encouraged|fine|ok)|promotion is allowed|advertising (is )?allowed/i;
V2.promoFromRules = function (rules, submitText, description) {
  // accepts Reddit's raw shape and the trimmed one the board stores
  const text = [(rules || []).map((r) => [r.short_name, r.name, r.description, r.what, r.violation_reason].filter(Boolean).join(" ")).join(" \n "), submitText || "", description || ""].join(" \n ");
  if (!text.trim()) return null;
  // an agency ban is checked before the weekly carve-out: "no marketing
  // agencies except approved vendors" is still a ban until we are one, and a
  // weekly promo thread does not make us an approved vendor
  if (/no (marketing |digital )?(agenc|vendor)|(agenc|vendor)(y|ies|s)? (are )?(not allowed|prohibited|banned|may not)|approved vendors only|vendor(s)? must be approved/i.test(text)) {
    return { promo: "no", why: "its own rules ban marketing agencies unless you are an approved vendor — message the moderators before posting anything" };
  }
  if (V2.WEEKLY_RE.test(text)) return { promo: "weekly", why: "its own rules send promotion to a weekly or pinned thread" };
  if (V2.NO_PROMO_RE.test(text)) return { promo: "no", why: "its own rules forbid self-promotion" };
  if (V2.OK_PROMO_RE.test(text)) return { promo: "ok", why: "its own rules say self-promotion is allowed" };
  return null;
};
// The unofficial ratio every Reddit moderator applies by eye: far more
// comments than posts. The board tracks it so the account never crosses it.
V2.ratio = function (posts, comments) {
  const p = posts || 0, c = comments || 0;
  const need = p * 5;
  return { posts: p, comments: c, need, ok: c >= need, short: Math.max(0, need - c),
    why: c >= need ? "the account reads as a participant" : "leave " + Math.max(0, need - c) + " more comments before the next post — moderators judge on this ratio, not on the posts alone" };
};

// ---------------------------------------------------- who is actually buying
// The v1 hunt scored intent. This one scores money. A post with a number in
// it beats a post with a feeling in it every time.
// A dollar figure or the word "spending" is proof. Jargon like CPL is not —
// anybody who read one blog post uses it — so the two are weighed apart.
V2.SPEND_RE = /\$\s?\d|\bad spend\b|\bspend(?:ing|s)?\b[^.?!]{0,40}(?:\d|month|week|day)|\bbudget of\b|\bretainer\b|\bquoted (?:me|us)\b|\bpaying\b[^.?!]{0,30}(?:\$|\ba month\b|\bper month\b)|\b\d[\d,]*\s?k?\s?(?:per month|a month|\/mo|monthly)\b/i;
V2.JARGON_RE = /\bcpl\b|\bcpa\b|\broas\b|\bcost per (?:lead|acquisition|click)\b|\bconversion rate\b|\bfunnel\b/i;
V2.AGENCY_RE = /\b(?:our|my|the|an|current|previous|last) (?:agency|marketing (?:agency|company|firm)|freelancer|consultant)\b|\bfired (?:our|the|my)\b|\blooking for an agency\b|\bhire an agency\b|\bagency (?:isn'?t|is not|stopped|charged|quoted)\b/i;
V2.TOOL_RE = /\b(?:ads manager|google ads|meta ads|facebook ads|tiktok ads|google business profile|gbp|klaviyo|hubspot|gohighlevel|go high ?level|semrush|ahrefs|shopify|wordpress|wix|squarespace|mailchimp|ga4|tag manager|search console)\b/i;
V2.OWNER_RE = /\b(?:my|our) (?:clinic|practice|shop|store|salon|gym|restaurant|firm|business|company|dealership|office|studio|brand)\b|\bi own\b|\bwe own\b|\bwe run a\b|\bi run a\b|\bowner of\b|\bwe have \d+ locations?\b/i;
V2.BROKE_RE = /\bno budget\b|\bfree (?:help|advice only|tool)\b|\bstudent\b|\bintern(?:ship)?\b|\bcan'?t afford\b|\bfor hire\b|\bhire me\b|\bmy portfolio\b|\blooking for work\b|\bequity only\b|\bco-?founder\b/i;
V2.classifyBuyer = function (title, body, sub) {
  const text = String(title || "") + " \n " + String(body || "");
  if (V2.BROKE_RE.test(text)) return { tier: 0, badge: "", keep: false, why: "no money in this one — someone selling, studying or asking for free help" };
  const spend = V2.SPEND_RE.test(text);
  const agency = V2.AGENCY_RE.test(text);
  const tool = V2.TOOL_RE.test(text);
  const owner = V2.OWNER_RE.test(text);
  const jargon = V2.JARGON_RE.test(text);
  const amount = (text.match(/\$\s?\d[\d,]*(?:\s?k\b)?/i) || [])[0] || "";
  if (spend) return { tier: 3, badge: "spending", keep: true, amount, why: "already spending money" + (amount ? " (" + amount.replace(/\s+/g, "") + ")" : "") + " and saying so in public" };
  if (agency) return { tier: 3, badge: "spending", keep: true, amount, why: "talking about an agency or freelancer they pay or paid" };
  if (owner) return { tier: 2, badge: "owner", keep: true, amount, why: tool ? "a business owner naming the tools they run themselves" : "a business owner talking about their own business" };
  if (tool || jargon) return { tier: 1, badge: "asking", keep: true, amount, why: "a marketing question with a platform behind it, but no proof of a budget yet" };
  return { tier: 0, badge: "", keep: false, why: "no money signal, no owner signal — a general question, not a buyer" };
};

// Site-wide searches that find money rather than ideas.
V2.SEARCHES = [
  "\"spending\" \"per month\" ads no leads", "\"our agency\" not working", "fired our marketing agency",
  "agency quoted me", "looking for an agency recommendations", "\"ad spend\" wasted",
  "google ads not converting small business", "facebook ads stopped working", "meta ads cost per lead went up",
  "\"cost per lead\" doubled", "roas dropped", "google business profile suspended",
  "\"not showing up\" google maps business", "rankings dropped traffic", "need more customers my business",
  "how do i get more leads for my", "\"we spend\" \"$\" marketing", "marketing budget where to spend",
  "is it worth hiring a marketing agency", "paying \"$\" a month for seo",
  "my clinic marketing", "my restaurant not getting customers", "contractor leads dried up",
  "\"per month\" retainer marketing worth it", "who should i hire to run my ads", "tried running ads myself",
];

// ----------------------------------------------- answering in public (free)
// The highest-return thing on Reddit and the cheapest: a complete, specific,
// free answer under a question a buyer asked. It sells nothing, which is
// exactly why it works — it is read by everyone who finds that thread later,
// and the people who need the work done come to us.
V2.ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string", description: "The public comment. Solves their problem completely. No pitch, no link, no DM ask." },
    specific: { type: "string", description: "The one concrete number, setting or step in the answer that proves it came from someone who has done this." },
    worth_it: { type: "string", description: "'yes' if this thread is worth the time, 'no' if the asker has no money or no business." },
    worth_reason: { type: "string", description: "One line of why." },
  },
  required: ["answer", "specific", "worth_it", "worth_reason"],
  additionalProperties: false,
};
V2.answerSystem = function (profile = {}) {
  return [
    "You write Reddit comments for " + (profile.name || "a small paid-ads and local-search team") + ".",
    "",
    "You are answering a stranger's question in public. You are not selling. Nothing in the comment may point anywhere.",
    "",
    "Rules:",
    "- Answer the actual question, fully, as if they will never pay you. Give away the real method.",
    "- One concrete specific: a number, a setting, a threshold, a menu path. Vague advice is worthless and reads as bait.",
    "- Name the trade-off or the thing that usually goes wrong. That is what makes it credible.",
    "- No links. No domain names. No 'DM me'. No 'we do this for clients'. No offer of any kind.",
    "- 60 to 220 words. Short paragraphs. Plain words.",
    "- You may end with a question back to them if something genuinely changes the answer.",
    "- If the asker is a student, a freelancer touting for work, or has no business behind the question, set worth_it to 'no'.",
  ].join("\n");
};
V2.answerUser = function (post, profile = {}) {
  return [
    "Room: r/" + (post.sub || ""),
    "Title: " + String(post.title || ""),
    "What they wrote: " + String(post.body || "").slice(0, 2400),
    profile.credit ? "\nTrue things about us, in our words, usable only if a line genuinely needs backing: " + profile.credit : "",
    "\nWrite the comment.",
  ].filter(Boolean).join("\n");
};
V2.answerChecks = function (a) {
  const text = String((a && a.answer) || "");
  const bad = [];
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words < 45) bad.push("the answer is too thin to be worth posting (" + words + " words)");
  if (words > 300) bad.push("the answer runs long (" + words + " words) — nobody reads past 250");
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|io|co|agency)\b/i.test(text)) bad.push("there is a link or domain in it");
  if (/\bdm me\b|\bpm me\b|\bcheck (your )?dm\b|\bhappy to help offline\b|\breach out\b/i.test(text)) bad.push("it points at a DM — a public answer must stand alone");
  if (/\bwe (offer|provide|specialise|specialize)\b|\bour (agency|team) (does|offers|handles)\b|\bhire\b.*\bus\b/i.test(text)) bad.push("it pitches");
  const tell = V2.AI_TELLS.find((w) => text.toLowerCase().includes(w));
  if (tell) bad.push('it contains "' + tell + '"');
  return bad;
};

// ----------------------------------------------------------- paid Reddit ads
// Kept as data so the board can show it as a working plan rather than a
// document nobody opens. Figures are starting points, not quotes — the ad
// account shows the real minimums and costs on the day you open it.
V2.ADS_PLAN = {
  idea: "On Reddit, ads that look like ads lose. The move is to post organically first, find the post that already earned upvotes and comments, and put money behind that exact post. You are paying to widen something the room has already approved.",
  stages: [
    { key: "seed", name: "Stage 1 — seed, weeks 1–4", spend: "$0",
      does: "Run the board. Post the value posts and the audit magnets by hand, answer in public daily.",
      out: "Three or four posts that earned real comments. Those are your ad creatives, already tested by the audience for free." },
    { key: "promote", name: "Stage 2 — promote the winners, weeks 5–6", spend: "about $20–30 a day",
      does: "Take the two organic posts with the best comment-to-view ratio and promote them to the subreddits they came from plus five neighbours. Objective: conversions if the pixel is live, otherwise traffic. Bid CPC, not CPM.",
      out: "A cost per comment and a cost per click you can compare against each other." },
    { key: "leadgen", name: "Stage 3 — lead form on the winner, weeks 7–8", spend: "about $30–50 a day",
      does: "Point the best-performing promoted post at a Reddit lead form offering the audit, not at a sales page. Three fields maximum: business name, city, what they sell.",
      out: "Leads at a measurable cost per lead. Anything under a quarter of a client's first-month value is working." },
    { key: "scale", name: "Stage 4 — widen, week 9 onward", spend: "raise 20% a week, never double",
      does: "Add interest targeting and lookalike-style expansion only after one subreddit set is profitable. Keep one untouched control.",
      out: "A channel you can leave running." },
  ],
  targeting: [
    { name: "Community targeting", how: "Name the subreddits directly — the owner rooms and the ad-spender rooms from the Targets tab. This is Reddit's real advantage over Meta: you are buying a room, not a guess about a person." },
    { name: "Interest targeting", how: "Broader, cheaper, worse. Use it only once a community set is already profitable, and keep it in its own campaign." },
    { name: "Keyword / conversation placement", how: "Places the ad inside threads about your terms. Strong for 'google ads not working' style intent. Test it as its own ad group so it can be judged alone." },
    { name: "Geography", how: "If the offer is local SEO, target the country or city you can actually serve. A cheap click from the wrong continent is still wasted." },
  ],
  formats: [
    { name: "Promoted organic post", note: "The one that works. Same text, same comment section, already proven." },
    { name: "Image post", note: "Use a screenshot of a real result — a ranking grid, a call volume chart. Stock imagery dies on Reddit." },
    { name: "Video", note: "A 30-second screen recording of an audit outperforms a polished brand film here." },
    { name: "Lead generation form", note: "For stage 3. Ask the minimum; every extra field costs you leads." },
  ],
  rules: [
    "Never turn comments off. A promoted post with a dead comment section reads as an ad and Reddit users punish it.",
    "Answer every comment on a promoted post within an hour. The comment section is the landing page.",
    "The account that promotes should be the account that has been answering questions for weeks. History is what makes the ad land.",
    "Judge on cost per booked call, never on clicks. Reddit clicks are cheap and curious.",
    "Install the Reddit pixel before spending a rupee, or you are buying blind.",
    "Kill an ad set at 3× your target cost per lead with no lead. Do not nurse it.",
  ],
  budget: { test: "$500 over the first four weeks of paid", verdict: "If four weeks and $500 have not produced one booked call, the offer is wrong, not the channel — change the offer before adding budget." },
};

// ---------------------------------------------------------------- campaigns
// 191 rooms is a menu, not a plan. A campaign is one niche: the rooms its
// owners actually sit in, the searches that find them spending money, the
// questions they ask over and over, and the offers that fit. Switch campaign
// and the whole board changes. Six or eight rooms, hit repeatedly, beats 191
// hit once — leads compound on the sixth exposure, not the first.
V2.CAMPAIGNS = [
  {
    key: "trade_lock", name: "Trade Lock",
    niche: "roofers, HVAC, plumbers, electricians and general contractors",
    why: "Highest job value of any local trade, worst marketing, and they talk about slow seasons in public.",
    subs: ["Roofing", "HVAC", "Plumbing", "Electricians", "Contractor", "Construction", "Painting", "landscaping", "PressureWashing", "JunkRemoval", "fencing", "Solar", "sweatystartup", "smallbusiness"],
    offers: ["gbp_audit", "local_pack", "pay_on_results", "dead_leads", "landing_fix"],
    searches: ["roofing leads dried up", "hvac company slow season marketing", "contractor google ads worth it",
      "plumber not showing up on google maps", "\"per lead\" roofing angi thumbtack", "contractor spending on ads no calls",
      "electrician marketing budget", "how do i get more jobs contractor"],
    queries: [
      "How much should a contractor spend on ads a month",
      "Are Angi / Thumbtack / HomeAdvisor leads worth it",
      "Why is my business not showing up on Google Maps",
      "Google Ads or Facebook for a trade business",
      "How do I get more jobs in the slow season",
      "Is a marketing agency worth it for a small trade",
      "How do I get more Google reviews",
      "Why did my leads suddenly drop",
      "What should a contractor website actually have",
      "How do I compete with the big franchise in my area",
    ],
  },
  {
    key: "chair_time", name: "Chair Time",
    niche: "dental, orthodontic, optometry, chiropractic and physio practices",
    why: "A patient is worth thousands over their life, the owner is a clinician not a marketer, and local search decides everything.",
    subs: ["dentistry", "Dentists", "Orthodontics", "optometry", "Chiropractic", "physicaltherapy", "Veterinary", "therapists", "GoogleBusinessProfile", "LocalSEO", "smallbusiness"],
    offers: ["gbp_audit", "local_pack", "90_day_plan", "seo_gap", "free_build"],
    searches: ["dental practice marketing new patients", "chiropractor google ads cost per patient",
      "optometry practice not getting new patients", "clinic marketing agency worth it",
      "\"new patients\" marketing spend practice", "physical therapy clinic marketing"],
    queries: [
      "How do I get more new patients without discounting",
      "Is a dental marketing agency worth the retainer",
      "How much does a new patient cost on Google Ads",
      "Why is my practice not in the map pack",
      "How do I get patients to leave reviews",
      "Google Ads or Facebook for a clinic",
      "What should a practice website have on it",
      "How do I stop competing on price with the corporate chain",
      "Is direct mail still worth it for a practice",
      "How do I track which marketing brings patients in",
    ],
  },
  {
    key: "glow_local", name: "Glow Local",
    niche: "medspas, salons, estheticians, barbers and studios",
    why: "High ticket, heavily visual, already running Instagram ads badly, and the whole business is bookings.",
    subs: ["medspa", "Esthetician", "eyelashextensions", "Hairstylist", "Barber", "Nailtechs", "Cosmetology", "massage", "personaltraining", "fitnessbusiness", "SocialMediaMarketing", "smallbusiness"],
    offers: ["creative_pack", "gbp_audit", "ads_teardown", "free_build", "local_pack"],
    searches: ["medspa marketing instagram ads", "salon not getting new clients", "esthetician marketing clients",
      "med spa ads cost per lead", "instagram ads for my salon", "how to fill my books salon"],
    queries: [
      "How do I fill empty appointment slots",
      "Do Instagram ads actually work for a salon",
      "How much should I spend on ads for a medspa",
      "How do I get clients who are not just chasing discounts",
      "What should I post on Instagram for my studio",
      "Is a booking app or Google the better source",
      "How do I get more reviews without asking awkwardly",
      "TikTok or Instagram for a beauty business",
      "Why did my Instagram reach collapse",
      "How do I stop no-shows",
    ],
  },
  {
    key: "case_load", name: "Case Load",
    niche: "law firms, accountants, bookkeepers and insurance agents",
    why: "One client is worth years of fees, the ad market is expensive, and almost none of them can measure what works.",
    subs: ["Lawyertalk", "LawFirm", "Accounting", "Bookkeeping", "taxpros", "InsuranceAgent", "InsuranceProfessional", "CFP", "Mortgages", "consulting", "smallbusiness"],
    offers: ["seo_gap", "landing_fix", "90_day_plan", "pay_on_results", "gbp_audit"],
    searches: ["law firm marketing cost per case", "accounting firm getting clients",
      "insurance agent lead generation cost", "bookkeeper finding clients", "\"cost per case\" google ads",
      "small law firm marketing budget"],
    queries: [
      "What does a case actually cost to acquire on Google Ads",
      "Is a legal marketing agency worth it for a solo firm",
      "How do I get clients other than referrals",
      "LSA or Google Ads for a law firm",
      "How do I get more reviews in a regulated industry",
      "How do I market an accounting practice outside tax season",
      "Why do my leads never answer the phone",
      "Is SEO worth it for a small firm",
      "How do I track where a client came from",
      "How do I stop paying for unqualified enquiries",
    ],
  },
  {
    key: "cart_lift", name: "Cart Lift",
    niche: "ecommerce and Shopify stores already buying ads",
    why: "They spend daily, they measure everything, and creative fatigue means they always need the next thing.",
    subs: ["ecommerce", "shopify", "shopifystore", "EcommerceMarketing", "dropship", "FacebookAds", "PPC", "GoogleAds", "Emailmarketing", "conversionoptimization", "landingpage"],
    offers: ["creative_pack", "ads_teardown", "landing_fix", "dead_leads", "free_build"],
    searches: ["shopify ads not profitable", "meta ads roas dropped store", "\"cost per purchase\" went up shopify",
      "creative fatigue facebook ads", "google shopping not converting", "email flows klaviyo revenue"],
    queries: [
      "Why did my ROAS suddenly collapse",
      "How much should I spend to test a new creative",
      "Meta or Google for a new store",
      "How do I fix creative fatigue",
      "What conversion rate should I expect",
      "Is an agency worth it at my spend level",
      "How do I set up tracking properly after iOS changes",
      "How many creatives do I need a month",
      "Why are my cold audiences not converting",
      "Klaviyo flows: what actually makes money",
    ],
  },
  {
    key: "ticket_desk", name: "Ticket Desk",
    niche: "MSPs, IT shops, staffing firms and B2B service companies",
    why: "Contract values are enormous, sales cycles are long, and their marketing is usually one referral away from nothing.",
    subs: ["msp", "sysadmin", "staffing", "recruiting", "consulting", "logistics", "Manufacturing", "CommercialCleaning", "SaaS", "B2BForHire", "smallbusiness"],
    offers: ["seo_gap", "dead_leads", "90_day_plan", "landing_fix", "pay_on_results"],
    searches: ["msp marketing getting clients", "staffing agency finding clients",
      "b2b lead generation cost per meeting", "cold email vs ads b2b", "managed services marketing budget"],
    queries: [
      "How does an MSP get clients other than referrals",
      "What does a B2B meeting cost to book",
      "Does LinkedIn or Google work better for B2B services",
      "Is cold email still worth doing",
      "How long is a realistic B2B sales cycle",
      "How do I market a service nobody searches for",
      "Should I niche down or stay general",
      "How do I get case studies when clients will not be named",
      "Is content marketing worth it for a services firm",
      "How do I stop competing on hourly rate",
    ],
  },
];
V2.campaign = function (key) { return V2.CAMPAIGNS.find((c) => c.key === key) || null; };
// Every campaign also gets the general business rooms, because a roofer with
// a marketing problem is as likely to ask in r/smallbusiness as in r/Roofing —
// and because a niche on its own rarely has enough rooms that take a post to
// keep three lanes fed without coming round too fast.
V2.SHARED_ROOMS = ["smallbusiness", "sweatystartup", "growmybusiness", "EntrepreneurRideAlong", "smallbusinessadvice", "solopreneur", "Business_Ideas", "roastmystartup"];
// A campaign only ever names rooms that are really in the list, and only ever
// plans into ones that take a post.
V2.campaignRooms = function (c, nicheOnly) {
  if (!c) return [];
  const names = nicheOnly ? (c.subs || []) : Array.from(new Set([...(c.subs || []), ...V2.SHARED_ROOMS]));
  return names.map((s) => V2.TARGETS.find((t) => t.sub === s)).filter(Boolean);
};
V2.campaignCheck = function (c) {
  const bad = [];
  for (const s of c.subs || []) if (!V2.TARGETS.some((t) => t.sub === s)) bad.push("r/" + s + " is not in the room list");
  for (const k of c.offers || []) if (!V2.OFFERS.some((o) => o.key === k)) bad.push(k + " is not a shipped offer");
  if ((c.subs || []).length < 6) bad.push("a campaign needs at least six rooms to rotate through");
  if ((c.queries || []).length < 8) bad.push("a campaign needs the questions its niche asks over and over");
  return bad;
};

// Some niches are answer-led rather than post-led. Clinic rooms, for
// instance, are almost all comments-only — you cannot post your way into
// r/dentistry, you have to become the person who answers there. The board
// says so out loud and sets the cadence to match instead of planning days it
// will only end up skipping.
V2.campaignShape = function (c) {
  const rooms = V2.campaignRooms(c);
  const n = rooms.filter(V2.postable).length;
  const nicheN = V2.campaignRooms(c, true).filter(V2.postable).length;
  // a room must not come round sooner than every five days, so the number of
  // lanes is whatever the rooms can actually carry — not whatever we wanted
  let perDay = 1;
  for (const p of [3, 2, 1]) if (Math.floor(n / p) >= 5) { perDay = p; break; }
  const subCoolDays = Math.max(3, Math.min(14, Math.floor(n / perDay)));
  const mode = nicheN >= 5 ? "post-led" : "answer-led";
  return {
    rooms: rooms.length, postable: n, nichePostable: nicheN, perDay, subCoolDays, mode,
    note: mode === "answer-led"
      ? "answer-led: only " + nicheN + " room" + (nicheN === 1 ? "" : "s") + " in this niche ever allow an offer, so the posts go to the general business rooms and the leads come from answering in the rest."
      : perDay === 3 ? "enough rooms to run all three lanes every day without any of them coming round inside " + subCoolDays + " days"
      : "run " + perDay + " lane" + (perDay === 1 ? "" : "s") + " a day here — more than that and the same rooms come round too fast",
  };
};

// ------------------------------------------------------------------ boost
// Which post deserves the ad money. Not the one we like — the one the room
// already argued with. Comments are the signal, because a promoted post is
// paid for by its comment section: a thread people are talking in keeps
// earning after the impression, and a silent one does not.
V2.BOOST_MIN_COMMENTS = 4;
V2.BOOST_MAX_AGE_DAYS = 7;
V2.boostScore = function (p, now) {
  const at = now || Date.now();
  const hours = Math.max(1, (at - (p.created || at)) / 3600000);
  const comments = p.comments || 0;
  const perHour = comments / Math.min(hours, 24);          // the first day is the tell
  const ageDays = hours / 24;
  const engaged = (p.score || 0) > 0 ? comments / Math.max(1, p.score) : comments;   // arguing beats upvoting
  let score = perHour * 40 + comments * 2 + (p.hot || 0) * 12 + Math.min(engaged, 3) * 10;
  if (ageDays > V2.BOOST_MAX_AGE_DAYS) score *= 0.25;
  if (p.magnet) score *= 1.35;
  score = Math.round(score);
  const why = [];
  if (comments >= 12) why.push(comments + " comments");
  else if (comments >= V2.BOOST_MIN_COMMENTS) why.push(comments + " comments, a start");
  if (perHour >= 1) why.push(Math.round(perHour * 10) / 10 + " an hour in its first day");
  if (p.hot) why.push(p.hot + " with a business behind them");
  if (p.magnet) why.push("it is an offer post, so every extra reader can raise a hand");
  let verdict = "no";
  if (comments < V2.BOOST_MIN_COMMENTS) verdict = "quiet";
  else if (ageDays > V2.BOOST_MAX_AGE_DAYS) verdict = "stale";
  else if (score >= 90) verdict = "boost";
  else if (score >= 45) verdict = "watch";
  else verdict = "thin";
  return {
    score, verdict, perHour: Math.round(perHour * 100) / 100, ageDays: Math.round(ageDays * 10) / 10,
    why: why.join(" · ") || "nothing has happened in it yet",
    advice: verdict === "boost" ? "put the money here"
      : verdict === "watch" ? "give it another few hours before spending"
      : verdict === "stale" ? "older than a week — a promoted post this old underperforms, use it as the template for the next one"
      : verdict === "quiet" ? "the room did not bite; promoting it would buy silence"
      : "not enough happening to be worth paying for",
  };
};
// A small budget is only small in the wrong room. £7 a day is invisible in
// r/marketing and dominant in a 40,000-member trade sub, so the plan is one
// room at a time, always-on, judged on what a comment costs.
V2.boostPlan = function (daily, days, post) {
  const d = Math.max(1, Math.min(100, Number(daily) || 7));
  const n = Math.max(1, Math.min(30, Number(days) || 7));
  const total = d * n;
  const comments = (post && post.comments) || 0;
  return {
    daily: d, days: n, total,
    room: post && post.sub ? "r/" + post.sub : "the room it was posted in",
    rule: "one room at a time, comments left on, always-on rather than in bursts",
    target: "aim under $3 a comment; over $6 and the post is not the one",
    expect: comments ? "it earned " + comments + " comments on its own, so treat anything under " + (comments * 2) + " bought comments as a poor return" : "",
    judge: "cost per comment, never cost per click — the comment section is the landing page",
  };
};
V2.boostCost = function (b) {
  const spent = Number(b.spent || 0);
  const got = Math.max(0, (b.commentsNow || 0) - (b.commentsAtStart || 0));
  const per = got ? Math.round((spent / got) * 100) / 100 : 0;
  return {
    spent, got, per,
    verdict: !got ? (spent >= 15 ? "$" + spent + " and not one comment — stop it, the room is not listening" : spent > 0 ? "nothing yet — if the next $10 buys no comment, stop it" : "not started")
      : per <= 3 ? "working — this is the room to keep feeding"
      : per <= 6 ? "acceptable, watch it"
      : "too expensive — stop and try the next post",
    // money with nothing to show for it is the clearest stop signal there is
    stop: (got > 0 && per > 6) || (got === 0 && spent >= 15),
  };
};

// ------------------------------------------------- reading a room properly
// Rules are what the moderators wrote. Precedent is what they actually
// enforce, and the two disagree more often than not: a room whose sidebar
// forbids self-promotion may be full of surviving free-audit posts, and a
// room with no rule against it may quietly remove every one. So the brief
// reads both — the rule text, and the last year of posts that tried the same
// thing we are about to try, marked by whether they are still standing.
V2.PROBE_QUERIES = [
  "free audit", "I'll review", "I will build", "drop your link", "giving away",
  "AMA", "teardown", "roast my", "for free", "no charge",
  "case study", "here's what we did", "spots left", "offering free",
];
V2.PROMO_RE = /\bfree\b[^.?!]{0,30}\b(audit|review|teardown|report|build|setup|check|analysis|look)\b|\bi'?ll (build|make|do|review|audit|write|design|set up|look at)\b|\bdrop (your|the) (link|url|site|website|name)\b|\bgiving (it )?away\b|\bno charge\b|\bfor free\b|\b\d+ spots?\b|\boffering\b[^.?!]{0,25}\bfree\b/i;
V2.CASE_RE = /\bcase study\b|\bhere'?s (what|how) (we|i) (did|built|ran|grew)\b|\bwent from\b[^.?!]{0,40}\bto\b|\b\d+ ?(x|%)\b[^.?!]{0,30}\b(growth|increase|more)\b|\bwhat (\d+ )?(months?|weeks?|years?) of\b/i;
V2.AMA_RE = /\bAMA\b|\bask me anything\b/i;
V2.SERVICE_RE = /\bmy agency\b|\bour agency\b|\bwe run ads\b|\bwe (manage|handle|do) (ads|seo|marketing)\b|\bour (clients|team)\b|\bfreelance(r)?\b|\bconsultant\b|\bi run a (marketing|digital|seo|ads) \w+\b|\bdm me (for|if)\b/i;

// A post is "removed" when Reddit says so, or when its body has been replaced
// by the usual tombstones. A post that is still standing after a day has
// survived the moderators, which is the only evidence that counts.
V2.classifyPromoPost = function (d, now) {
  const at = now || Date.now();
  const title = String(d.title || "");
  const body = String(d.selftext || "");
  const text = title + "\n" + body;
  const removed = !!d.removed_by_category || /^\[(removed|deleted)\]$/i.test(body.trim()) || String(d.author || "") === "[deleted]";
  let kind = "";
  if (V2.AMA_RE.test(title)) kind = "ama";
  else if (V2.PROMO_RE.test(text)) kind = "offer";
  else if (V2.CASE_RE.test(text)) kind = "case";
  else if (V2.SERVICE_RE.test(text)) kind = "service";
  if (!kind) return null;
  const created = (d.created_utc || 0) * 1000;
  const ageH = (at - created) / 3600000;
  return {
    id: d.id, kind, removed,
    survived: !removed && ageH > 24,
    tooNew: !removed && ageH <= 24,
    author: String(d.author || ""),
    title: title.slice(0, 200),
    sub: String(d.subreddit || ""),
    permalink: "https://www.reddit.com" + String(d.permalink || ""),
    created, score: d.score || 0, comments: d.num_comments || 0,
    service: V2.SERVICE_RE.test(text),
    // kept so the shape of what survived can be read back later
    body: removed ? "" : body.replace(/\s+/g, " ").slice(0, 1400),
  };
};

// The verdict a person actually needs before pressing Post: may we, and what
// is the evidence either way. The rule text outranks the precedent — a room
// that bans agencies bans us even if ten agency posts are still standing,
// because those authors may be approved vendors and we are not.
V2.briefVerdict = function (opts = {}) {
  const rule = opts.rule || null;                 // from promoFromRules
  // every count defaulted: a missing field must not turn a sum into NaN and
  // quietly report a room as untested when three posts were removed in it
  const n = (x) => Number(x) || 0;
  const raw = opts.precedent || {};
  const p = { offer: n(raw.offer), survivedOffer: n(raw.survivedOffer), removedOffer: n(raw.removedOffer),
    case: n(raw.case), survivedCase: n(raw.survivedCase), removedCase: n(raw.removedCase) };
  const reasons = [];
  let verdict = "ok";
  if (rule && /approved vendor/.test(rule.why || "")) {
    verdict = "never";
    reasons.push("its own rules ban marketing agencies unless you are an approved vendor — ask the moderators first, do not post");
  } else if (rule && rule.promo === "no") {
    verdict = "comments";
    reasons.push("its own rules forbid self-promotion, so the only thing that goes in here is an answer under somebody else's thread");
  } else if (rule && rule.promo === "weekly") {
    verdict = "weekly";
    reasons.push("its own rules send promotion to a weekly or pinned thread — find that thread rather than making a post");
  }
  // precedent, which can soften a guess but never overrule a written ban
  if (p.offer + p.case > 0) {
    const survived = p.survivedOffer + p.survivedCase;
    const removed = p.removedOffer + p.removedCase;
    if (survived >= 3) reasons.push(survived + " posts like ours are still standing here, so this shape of post does get through");
    else if (survived > 0) reasons.push("only " + survived + " post like ours is still standing — thin evidence, go carefully");
    if (removed > 0) reasons.push(removed === 1 ? "one was removed, so the moderators do act on this" : removed + " were removed, so the moderators do act on this");
    if (removed > 0 && survived === 0 && verdict === "ok") { verdict = "risky"; reasons.push("every one that tried was taken down"); }
  } else {
    reasons.push("nothing like our post has been tried here in the last year, so there is no precedent either way");
    if (verdict === "ok") verdict = "untested";
  }
  const say = {
    never: "Do not post here",
    comments: "Answer here, never post",
    weekly: "Only in its weekly thread",
    risky: "Risky — posts like ours get removed here",
    untested: "No precedent — be the first, carefully",
    ok: "Safe to post",
  };
  return { verdict, headline: say[verdict], reasons, blocked: verdict === "never" || verdict === "comments" };
};

// What Claude is asked to do with the rule text: read it as a person would
// and say plainly what it forbids, in its own words, with the line it comes
// from — not a summary, a quotation, so the judgement can be checked.
V2.RULES_SCHEMA = {
  type: "object",
  properties: {
    may_post: { type: "string", description: "'yes', 'no' or 'weekly' — whether an offer post is allowed here at all." },
    quote: { type: "string", description: "The exact sentence from the rules that decides it, copied verbatim. Empty if no rule addresses it." },
    plain: { type: "string", description: "What the rules forbid, in two or three plain sentences a person can act on." },
    shape: { type: "string", description: "How a post has to be shaped to be welcome here, given these rules and what has survived." },
    watch: { type: "string", description: "The single rule most likely to catch us out, and why." },
  },
  required: ["may_post", "quote", "plain", "shape", "watch"],
  additionalProperties: false,
};
V2.rulesSystem = function () {
  return [
    "You read a subreddit's rules and tell a marketer what they may and may not do there.",
    "",
    "You are cautious on their behalf. If a rule could reasonably be read as forbidding what they want to do, say so — a removed post costs them the room, and sometimes the account.",
    "Quote the deciding sentence exactly as written. Never paraphrase it into the quote field. If no rule addresses promotion at all, leave the quote empty and say so.",
    "Treat 'no advertising', 'no self-promotion', 'no agencies', 'approved vendors only' and 'vendors must be approved' as forbidding it. An 'except approved vendors' carve-out does not help someone who is not an approved vendor.",
    "Do not soften a rule because posts like theirs are still standing — those authors may have permission they do not have.",
  ].join("\n");
};
V2.rulesUser = function (target, about, rules, precedent) {
  const lines = ["Room: r/" + (typeof target === "string" ? target : target.sub)];
  if (about && about.title) lines.push("What it says it is: " + about.title);
  if (about && about.members) lines.push("Size: " + about.members.toLocaleString() + " members");
  lines.push("", "Its rules, as published:");
  if (!(rules || []).length) lines.push("(this room publishes no rules)");
  for (const r of rules || []) lines.push("- " + (r.name || r.short_name || "") + (r.what || r.description ? ": " + (r.what || r.description) : ""));
  if (about && about.submitText) lines.push("", "What it shows people about to post: " + about.submitText);
  if (precedent && precedent.length) {
    lines.push("", "Posts like ours that have been tried here, newest first:");
    for (const p of precedent.slice(0, 14)) lines.push(`- [${p.removed ? "REMOVED" : p.survived ? "still up" : "too new to tell"}] ${p.kind}: ${p.title} (${p.score} points, ${p.comments} comments)`);
  } else {
    lines.push("", "Nothing like our post has been tried here in the last year.");
  }
  lines.push("", "We want to make a post that gives something away and asks people to comment. Read the rules and answer.");
  return lines.join("\n");
};
V2.rulesChecks = function (r, rules) {
  const bad = [];
  if (!r) return ["nothing came back"];
  if (!["yes", "no", "weekly"].includes(String(r.may_post || "").toLowerCase())) bad.push("it did not say plainly whether we may post");
  if (!r.plain || r.plain.length < 30) bad.push("the plain reading is too thin to act on");
  if (!r.shape || r.shape.length < 20) bad.push("it did not say how to shape the post");
  // a quote has to be a quote: it must actually appear in the rules we sent
  const hay = (rules || []).map((x) => [x.name, x.short_name, x.what, x.description].filter(Boolean).join(" ")).join(" \n ").toLowerCase();
  const q = String(r.quote || "").trim().toLowerCase();
  if (q && hay && !hay.includes(q.slice(0, Math.min(40, q.length)))) bad.push("the quoted rule is not in the rules it was given — it was paraphrased or invented");
  return bad;
};

// ------------------------------------------------------------ the fit matrix
// Offers down one axis, rooms across the other, every cell saying whether
// this offer may go into this room — and if not, why not. The calendar picks
// from the green cells, a blocked day walks along its row to the next green
// one, and the dedupe rules are what turn cells amber and red.
V2.FIT_STATES = {
  green: { name: "Run it", rank: 3 },
  amber: { name: "Only if you must", rank: 2 },
  grey: { name: "Untested", rank: 1 },
  red: { name: "No", rank: 0 },
};
// Words that say a room and an offer are about the same trade. Crude on
// purpose: the campaign already did the hard narrowing, this only stops a
// roofing offer being sent to a dentist.
V2.fitWords = function (text) {
  return new Set(String(text || "").toLowerCase().match(/[a-z]{4,}/g) || []);
};
V2.FIT_STOP = new Set(["that", "this", "with", "your", "they", "them", "their", "from", "have", "been", "were", "will", "what", "when", "which", "would", "there", "about", "business", "businesses", "owner", "owners", "company", "companies", "anyone", "anything", "already", "month", "months", "spending", "people", "clients", "customers"]);
V2.fitScore = function (offer, room, opts = {}) {
  const brief = opts.brief || null;
  const used = opts.used || null;          // {at, removed, survived} for this offer in this room
  const health = opts.health || { removed: 0, retired: false };
  const why = [];
  let state = "grey", score = 0;

  // 1. the rules, which are a gate and not a score
  if (brief && brief.verdict && brief.verdict.blocked) {
    return { state: "red", score: 0, allowed: false, why: [brief.verdict.headline.toLowerCase() + " — " + (brief.verdict.reasons[0] || "")], headline: brief.verdict.headline };
  }
  if (!V2.postable(room)) return { state: "red", score: 0, allowed: false, why: ["this room does not take an offer post at all"], headline: "Answer here, never post" };

  // 1b. do these people even own the thing the offer is about. This is a gate
  // and not a score, because no amount of word overlap makes a Google Business
  // Profile audit meaningful to a room full of startup founders.
  const aud = V2.audienceFit(offer, room);
  if (!aud.ok) return { state: "red", score: 0, allowed: false, why: [aud.why], headline: "Wrong people" };

  // 2. have we already been here with this offer
  if (used) {
    if (used.removed) return { state: "red", score: 0, allowed: false, why: ["we ran this offer here and it was removed"], headline: "Removed here before" };
    return { state: "amber", score: 5, allowed: false, why: ["we already ran this offer here" + (used.survived ? " and it stood — repeat it somewhere new, not here" : "")], headline: "Already used here" };
  }
  if (health.retired) return { state: "red", score: 0, allowed: false, why: ["this offer has been removed " + health.removed + " times — improve it before it goes anywhere else"], headline: "Offer retired" };
  if (health.removed) { score -= 10; why.push("this offer has been removed once elsewhere"); }

  // 3. does the trade match
  const a = V2.fitWords([offer.who, offer.gift, offer.name].join(" "));
  const b = V2.fitWords([room.note, room.sub, opts.campaignNiche || ""].join(" "));
  let shared = 0;
  for (const w of a) if (!V2.FIT_STOP.has(w) && b.has(w)) shared += 1;
  if (shared >= 2) { score += 25; why.push("the offer and the room are about the same trade"); }
  else if (shared === 1) { score += 10; }
  else if (opts.campaignRoom) { score += 8; why.push("it is in this campaign's room list"); }

  // 4. what has actually survived in here
  if (brief) {
    const c = brief.counts || {};
    if (c.survivedOffer >= 3) { score += 40; state = "green"; why.push(c.survivedOffer + " offer posts are still standing here"); }
    else if (c.survivedOffer > 0) { score += 22; state = "green"; why.push("an offer post has survived here"); }
    else if (c.removedOffer > 0) { score -= 25; state = "amber"; why.push("every offer post tried here was removed"); }
    else { score += 5; why.push("nobody has tried an offer here"); }
    if (c.survivedCase > 0) { score += 8; why.push("result posts do well here"); }
    if (c.recent && c.recentRemoved / c.recent > 0.15) { score -= 12; why.push("this room removes a lot of what is posted in it"); }
  } else {
    why.push("this room has not been read yet — press check before posting into it");
  }

  // 5. size, lightly: a big room is worth more, but not much more
  const m = (opts.members || 0);
  if (m >= 100000) score += 10; else if (m >= 20000) score += 6; else if (m >= 5000) score += 3;
  if (opts.online >= 200) score += 4;

  const promoRank = (V2.PROMO[room.promo] || {}).rank || 0;
  if (promoRank === 1) { score -= 8; why.push("offers belong in its weekly thread here"); }
  if (promoRank === 3) score += 6;

  if (state === "grey" && score >= 40) state = "green";
  if (state === "green" && score < 15) state = "amber";
  return { state, score: Math.round(score), allowed: state === "green" || state === "grey", why, headline: V2.FIT_STATES[state].name };
};

// One offer, every room it could go to, best first. The chain is what a
// blocked day walks along.
V2.fitChain = function (offer, rooms, opts = {}) {
  const briefs = opts.briefs || {};
  const ledger = opts.ledger || {};
  const checked = opts.checked || {};
  const health = (opts.health || {})[offer.key] || { removed: 0, retired: false };
  const out = rooms.map((room) => {
    const c = checked[room.sub] || {};
    const fit = V2.fitScore(offer, room, {
      brief: briefs[room.sub] || null,
      used: ledger[offer.key + "|" + room.sub] || null,
      health,
      members: c.members || 0, online: c.online || 0,
      campaignRoom: !!opts.campaignRooms && opts.campaignRooms.includes(room.sub),
      campaignNiche: opts.campaignNiche || "",
    });
    return { sub: room.sub, kind: room.kind, promo: room.promo, members: c.members || 0, online: c.online || 0, ...fit };
  });
  out.sort((x, y) => (V2.FIT_STATES[y.state].rank - V2.FIT_STATES[x.state].rank) || (y.score - x.score) || x.sub.localeCompare(y.sub));
  return out;
};
// An offer that keeps getting pulled is the problem, not the rooms.
V2.offerHealth = function (key, ledger) {
  let removed = 0, survived = 0, used = 0;
  for (const [k, v] of Object.entries(ledger || {})) {
    if (!k.startsWith(key + "|")) continue;
    used += 1;
    if (v.removed) removed += 1;
    if (v.survived) survived += 1;
  }
  return { used, removed, survived, retired: removed >= 2,
    why: removed >= 2 ? "removed " + removed + " times — improve it before running it again" : removed === 1 ? "removed once, watch it" : used ? used + " rooms used, " + survived + " still standing" : "never run" };
};

// ------------------------------------------- what survives in this room
// The posts still standing are the only honest style guide a room has. This
// reads them and describes the shape: how the author stood, what they gave
// away, what they asked for, how long it ran.
//
// The one thing it must never do is copy who the author claimed to be. The
// med-spa post that survives a ban on agencies survives partly because its
// author is a practitioner inside that trade. We are not, and pretending to
// be is worse than being removed — it is a lie to the people we want as
// clients, and a permanent ban rather than a deleted post.
V2.SHAPE_SCHEMA = {
  type: "object",
  properties: {
    stance: { type: "string", description: "How the surviving authors stand relative to the room: what they lead with about themselves, in a way we could honestly match." },
    gives: { type: "string", description: "What they give away, concretely." },
    asks: { type: "string", description: "What they ask for, if anything." },
    structure: { type: "string", description: "How the post is built, start to finish, in a few clauses." },
    length: { type: "string", description: "Roughly how long, and how it is broken up." },
    avoid: { type: "string", description: "What the removed posts did that the surviving ones did not." },
    opening: { type: "string", description: "One honest opening line we could use, written for an outside marketing team — never claiming to work inside the trade." },
    confidence: { type: "string", description: "'high', 'low' or 'none' — how much evidence there actually was." },
  },
  required: ["stance", "gives", "asks", "structure", "length", "avoid", "opening", "confidence"],
  additionalProperties: false,
};
V2.shapeSystem = function (profile = {}) {
  return [
    "You study the posts that survived in one subreddit and describe the shape they share, so that someone can write one like it.",
    "",
    "Who you are writing for: " + (profile.name || "a small outside marketing team") + ". They run ads and local search for other people's businesses. They are an agency. They do not work inside the trade this room is for.",
    "",
    "The rule that matters most: never describe a stance they cannot honestly take. If the surviving posts work because their authors are practitioners — a clinic owner, a contractor, the CMO of a business in this trade — say so plainly and then give the honest equivalent an outside team can stand on, which is usually the volume of work they have done across many of these businesses. Never suggest claiming to be an owner, an operator, a practitioner, an employee or a customer.",
    "",
    "Describe only what the evidence supports. If two posts survived, say the confidence is low. If none did, say none, and say what the removed ones had in common instead.",
    "Be concrete: 'opens with a number from their own account, then five numbered findings, then a question' is useful. 'Be authentic and provide value' is not.",
  ].join("\n");
};
V2.shapeUser = function (sub, survived, removed) {
  const lines = ["Room: r/" + (typeof sub === "string" ? sub : sub.sub), ""];
  if (!survived.length) lines.push("No post like ours has survived here.");
  else {
    lines.push("Posts that are still standing:");
    for (const p of survived.slice(0, 8)) {
      lines.push("", "— " + p.title + "  (" + p.score + " points, " + p.comments + " comments, " + p.kind + ")");
      if (p.body) lines.push("  " + p.body.slice(0, 900));
    }
  }
  if (removed.length) {
    lines.push("", "Posts that were removed:");
    for (const p of removed.slice(0, 8)) lines.push("— " + p.title);
  }
  lines.push("", "Describe the shape.");
  return lines.join("\n");
};
V2.SHAPE_CLAIM_RE = /\b(say|claim|present|position|describe) (yourself|themselves|ourselves|you) (as|to be) (an? )?(owner|operator|practitioner|clinician|dentist|doctor|contractor|customer|patient|employee|insider|cmo)\b|\bpretend\b|\bpose as\b|\bact as if you (own|run|work)\b/i;
V2.shapeChecks = function (sh) {
  const bad = [];
  if (!sh) return ["nothing came back"];
  if (!["high", "low", "none"].includes(String(sh.confidence || "").toLowerCase())) bad.push("it did not say how much evidence there was");
  if (!sh.structure || sh.structure.length < 25) bad.push("the structure is too vague to write from");
  if (!sh.opening || sh.opening.length < 20) bad.push("there is no opening line");
  const all = [sh.stance, sh.opening, sh.structure].join(" ");
  if (V2.SHAPE_CLAIM_RE.test(all)) bad.push("it suggests claiming to be someone we are not");
  const IAM = /\bi(?:'m| am) (?:the|an?) (?:cmo|ceo|owner|founder|director|manager|practitioner|clinician|operator|dentist|doctor|nurse|injector|contractor|roofer|technician)\b|\bi (?:own|run|manage) an? (?:med ?spa|medspa|clinic|practice|salon|shop|restaurant|gym|roofing|hvac|plumbing|dental)\b|\bas (?:the|an?) (?:owner|operator|practitioner) (?:of|here)\b/i;
  if (IAM.test(String(sh.opening || "")) || IAM.test(String(sh.stance || ""))) bad.push("it puts us inside the trade, which we are not");
  return bad;
};
// Folded into the post prompt so the writer builds in the shape that survived.
V2.shapeBlock = function (sh) {
  if (!sh || String(sh.confidence || "").toLowerCase() === "none") return "";
  return [
    "",
    "What actually survives in this room" + (String(sh.confidence).toLowerCase() === "low" ? " (thin evidence — treat as a hint, not a rule)" : "") + ":",
    "- How those authors stand: " + sh.stance,
    "- What they give away: " + sh.gives,
    "- What they ask for: " + sh.asks,
    "- How the post is built: " + sh.structure,
    "- Length: " + sh.length,
    "- What the removed ones did: " + sh.avoid,
    "Match that shape. Do not match any claim about who the author is — we are an outside marketing team and the post must read as one.",
  ].join("\n");
};

// ---------------------------------------------------------------- what it costs
// Not every call needs the same model. Reading rules out of text somebody else
// wrote is extraction, and the cheapest model does it as well as the dearest.
// Writing the post that goes out in our name is not, so that one keeps the
// better model. Prices are per million tokens, in, out.
V2.PRICES = { "claude-haiku-4-5": [1, 5], "claude-sonnet-5": [2, 10], "claude-opus-5": [5, 25] };
V2.JOBS = {
  post: { name: "the post itself", model: "claude-sonnet-5", why: "this one goes out in our name" },
  offers: { name: "writing offers", model: "claude-sonnet-5", why: "the wording is the product" },
  improve: { name: "improving an offer", model: "claude-sonnet-5", why: "judgement, not extraction" },
  answer: { name: "a public answer", model: "claude-sonnet-5", why: "read by strangers for years" },
  shape: { name: "what survives in a room", model: "claude-haiku-4-5", why: "summarising posts we already have" },
  rules: { name: "reading a room's rules", model: "claude-haiku-4-5", why: "pulling a quote out of text we supply" },
  ideas: { name: "brainstorming ideas", model: "claude-haiku-4-5", why: "quantity first; the good ones get written properly after" },
};
V2.jobModel = function (job, profile = {}) {
  const j = V2.JOBS[job] || V2.JOBS.post;
  if (profile.cheap) return "claude-haiku-4-5";              // everything on the cheapest
  const pick = profile.aiModel;
  // an explicit choice only ever raises the writing jobs, never the extraction
  if (pick && V2.PRICES[pick] && j.model !== "claude-haiku-4-5") return pick;
  return j.model;
};
V2.cents = function (model, u = {}) {
  const [pin, pout] = V2.PRICES[model] || V2.PRICES["claude-sonnet-5"];
  const usd = ((u.input_tokens || 0) * pin
    + (u.cache_creation_input_tokens || 0) * pin * 1.25
    + (u.cache_read_input_tokens || 0) * pin * 0.1
    + (u.output_tokens || 0) * pout) / 1e6;
  return Math.round(usd * 1000) / 10;
};
// Output is where the money goes: a thousand written tokens cost five times
// what a thousand read ones do. This is what the board shows so the number is
// never a surprise.
V2.costSplit = function (rows) {
  const by = {};
  let cents = 0, cached = 0, inTok = 0, outTok = 0;
  for (const r of rows || []) {
    const k = r.kind || "other";
    const b = (by[k] = by[k] || { kind: k, calls: 0, cents: 0, in: 0, out: 0 });
    b.calls += 1; b.cents = Math.round((b.cents + (r.cents || 0)) * 100) / 100;
    b.in += r.in || 0; b.out += r.out || 0;
    cents += r.cents || 0; cached += r.cached || 0; inTok += r.in || 0; outTok += r.out || 0;
  }
  const list = Object.values(by).sort((a, b) => b.cents - a.cents);
  return {
    rows: list, cents: Math.round(cents * 100) / 100, in: inTok, out: outTok, cached,
    hit: inTok ? Math.round((cached / (inTok + cached)) * 100) : 0,
    worst: list[0] || null,
    note: outTok > inTok / 3
      ? "most of this is what the model wrote, not what it read — shorter posts and fewer rewrites are where the savings are"
      : "most of this is what the model read — caching and shorter prompts are where the savings are",
  };
};

// ----------------------------------------------------------------- ideas
// The thing that was missing between "I have an offer" and "a post went out":
// somewhere to think out loud. Type a rough idea, get eight angles back, and
// each one already knows which shape of post it is and which kind of room it
// belongs in — so the board can put it straight into a green cell.
V2.IDEA_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      description: "Eight post ideas, each a different angle on the same business.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "The Reddit title itself, written as it would be posted. Plain, specific, under 140 characters." },
          angle: { type: "string", description: "What makes this one different from the other seven, in a few words." },
          shape: { type: "string", description: "One of: audit_magnet, result_story, teardown, playbook, mistakes, comparison, giveaway, question_ask, ama, local_case." },
          room_kind: { type: "string", description: "Where it belongs: 'ads' for people already spending, 'owner' for a trade's own room, 'biz' for general business." },
          gives: { type: "string", description: "What the reader gets out of reading it, concretely." },
          hook: { type: "string", description: "The first line of the post." },
          risk: { type: "string", description: "Why a moderator might remove it, or 'none'." },
        },
        required: ["title", "angle", "shape", "room_kind", "gives", "hook", "risk"],
        additionalProperties: false,
      },
    },
  },
  required: ["ideas"],
  additionalProperties: false,
};
V2.ideaSystem = function (profile = {}) {
  return [
    "You brainstorm Reddit post ideas for " + (profile.name || "a small marketing team") + (profile.place ? " in " + profile.place : "") + ". They run paid ads and local search for other people's businesses.",
    "",
    "Eight ideas, eight different angles. Quantity and range matter more here than polish — the good ones get written properly afterwards.",
    "",
    "Spread them across the shapes rather than writing eight versions of one post:",
    ...V2.POST_TYPES.map((t) => "- " + t.key + " (" + t.name + "): " + t.shape),
    "",
    "Rules:",
    "- Every title must be one a real person would click, and specific enough that you could only write it if you had done the work. No 'The Ultimate Guide to'.",
    "- No links, no prices, no agency name, no emoji.",
    "- Only two of the eight may be magnet shapes (audit_magnet, giveaway, ama). The rest give something away and sell nothing.",
    "- Say honestly in 'risk' what would get each one removed. 'none' is allowed but rare.",
    "- We are an outside team. Never propose an idea that needs us to claim we work inside the trade.",
  ].join("\n");
};
V2.ideaUser = function (seed, campaign, profile = {}) {
  const lines = [];
  if (campaign) lines.push("The niche: " + campaign.niche, "Why them: " + campaign.why, "",
    "What they ask over and over:", ...campaign.queries.slice(0, 10).map((q) => "- " + q), "");
  lines.push(seed ? "What we want to talk about: " + String(seed).slice(0, 1500) : "No particular starting point — find the angles worth taking.");
  if (profile.credit) lines.push("", "True things about us: " + profile.credit);
  if (profile.wins) lines.push("Real results we can cite: " + profile.wins);
  lines.push("", "Give me eight.");
  return lines.join("\n");
};
V2.ideaClean = function (d, i) {
  const shape = V2.POST_TYPES.some((t) => t.key === d.shape) ? d.shape : "playbook";
  const kind = ["ads", "owner", "biz"].includes(d.room_kind) ? d.room_kind : "biz";
  return {
    id: "idea_" + Date.now().toString(36) + "_" + i,
    title: String(d.title || "").slice(0, 300),
    angle: String(d.angle || ""), shape, kind,
    gives: String(d.gives || ""), hook: String(d.hook || ""),
    risk: String(d.risk || ""), magnet: !!V2.postType(shape).magnet,
    at: Date.now(),
  };
};
V2.ideaChecks = function (list) {
  const bad = [];
  if (!list || !list.length) return ["nothing came back"];
  const magnets = list.filter((x) => x.magnet).length;
  if (magnets > 3) bad.push(magnets + " of them are asking for something — a list that is mostly offers is not a brainstorm");
  if (new Set(list.map((x) => x.shape)).size < 3) bad.push("they are all the same shape");
  for (const x of list) {
    if (x.title.length < 15) bad.push("one title is too short to be real");
    // the same reading of "a link" the post gate uses, so a bare domain counts
    if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|agency|marketing)\b/i.test(x.title + " " + x.hook)) bad.push("one of them has a link in it");
    if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(x.title)) bad.push("one title has an emoji");
  }
  return Array.from(new Set(bad));
};

// ------------------------------------------------- writing it for nothing
// A post is mostly structure. The only parts that have to come from a model
// are the few facts nobody could guess — and even those you already know,
// because they are your own numbers. So the free engine assembles the post
// from templates and the offer you picked, deterministically, and costs
// nothing at all. The model becomes an upgrade rather than a dependency.
V2.fnv = function (s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < String(s).length; i += 1) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  // murmur3 fmix, so two nearly identical seeds land far apart
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
};
V2.pick = function (list, seed, salt) { return list[V2.fnv(String(seed) + "|" + String(salt)) % list.length]; };

// What the people in a room call their own work.
V2.TRADE = {
  Roofing: ["roofing company", "roof", "roofs"], HVAC: ["HVAC company", "job", "jobs"], Plumbing: ["plumbing company", "callout", "callouts"],
  Electricians: ["electrical company", "job", "jobs"], Contractor: ["contracting business", "job", "jobs"], Construction: ["construction firm", "project", "projects"],
  Painting: ["painting company", "job", "jobs"], landscaping: ["landscaping company", "job", "jobs"], PressureWashing: ["pressure washing round", "job", "jobs"],
  JunkRemoval: ["junk removal company", "pickup", "pickups"], PestControl: ["pest control round", "treatment", "treatments"], Roofing2: ["roofing company", "roof", "roofs"],
  dentistry: ["practice", "new patient", "new patients"], Dentists: ["practice", "new patient", "new patients"], Orthodontics: ["practice", "case", "cases"],
  optometry: ["practice", "patient", "patients"], Chiropractic: ["clinic", "patient", "patients"], physicaltherapy: ["clinic", "patient", "patients"],
  medspa: ["med spa", "consult", "consults"], Esthetician: ["studio", "booking", "bookings"], Hairstylist: ["salon", "booking", "bookings"],
  Barber: ["shop", "booking", "bookings"], massage: ["practice", "booking", "bookings"],
  Lawyertalk: ["firm", "case", "cases"], LawFirm: ["firm", "case", "cases"], Accounting: ["practice", "client", "clients"], Bookkeeping: ["practice", "client", "clients"],
  InsuranceAgent: ["agency", "policy", "policies"], realtors: ["business", "listing", "listings"], restaurateur: ["restaurant", "cover", "covers"],
  Moving: ["moving company", "move", "moves"], AutoDetailing: ["detailing business", "booking", "bookings"], msp: ["MSP", "contract", "contracts"],
  ecommerce: ["store", "order", "orders"], shopify: ["store", "order", "orders"], PPC: ["account", "lead", "leads"], GoogleAds: ["account", "lead", "leads"],
  FacebookAds: ["account", "lead", "leads"],
};
// "business" + "s" is "businesss". One line, and it keeps every title honest.
V2.plural = function (w) {
  const x = String(w || "");
  if (/(s|x|z|ch|sh)$/i.test(x)) return x + "es";
  if (/[^aeiou]y$/i.test(x)) return x.slice(0, -1) + "ies";
  return x + "s";
};
V2.tradeOf = function (sub, campaign) {
  if (V2.TRADE[sub]) return { biz: V2.TRADE[sub][0], unit: V2.TRADE[sub][1], units: V2.TRADE[sub][2] };
  const c = campaign && campaign.key;
  if (c === "chair_time") return { biz: "practice", unit: "new patient", units: "new patients" };
  if (c === "glow_local") return { biz: "studio", unit: "booking", units: "bookings" };
  if (c === "case_load") return { biz: "firm", unit: "case", units: "cases" };
  if (c === "cart_lift") return { biz: "store", unit: "order", units: "orders" };
  if (c === "ticket_desk") return { biz: "business", unit: "contract", units: "contracts" };
  if (c === "trade_lock") return { biz: "business", unit: "job", units: "jobs" };
  return { biz: "business", unit: "enquiry", units: "enquiries" };
};

// The parts. Each is a list, and the seed decides which one is used, so the
// same room never gets the same sentence twice in a row.
V2.FREE_OPEN = [
  "I do this for a living and the same three things come up every time, so here they are in full.",
  "Spent this week going through these one by one. Writing down what I found in case it saves someone a month.",
  "This comes up here constantly and the answers are usually half right, so this is the whole thing.",
  "Nobody enjoys reading a long post, so the short version is at the top and the detail is underneath.",
  "I have been doing this long enough to have made all of these mistakes myself. Here is the list.",
];
V2.FREE_CLOSE = [
  "That is the whole method. Nothing held back.",
  "None of this needs anyone else to do it. It is a weekend of work.",
  "Take it or leave it, but that is what the numbers keep saying.",
  "It is not clever. It is just the order things have to be done in.",
];
V2.FREE_ASK = [
  "What is the one thing that keeps not working for you?",
  "Which of these have you already tried?",
  "What am I missing here?",
  "What would you add to this?",
  "Where does yours break down?",
];
V2.FREE_POINTS = {
  local: [
    ["Your categories are probably wrong", "The primary category decides most of what you rank for and almost nobody changes theirs after the first week. Look at whoever is above you, note their primary category, and ask yourself honestly whether it beats yours."],
    ["You are judged from where the searcher stands, not from your desk", "Searching your own name from your own office tells you nothing. Move a mile away and search again. Most people find they vanish three streets from their own door."],
    ["Photos are a ranking signal and a conversion one", "A profile with fresh photos every month behaves differently to one with eight from 2019. Put a recurring reminder in and take five on a phone."],
    ["Reviews matter less than the replies to them", "Volume is table stakes. What moves things is a reply under every one, with the service and the town written into the reply like a human would say them."],
    ["The services list is empty on nearly every profile I open", "Every service you offer is a thing people type. If it is not listed, you are not in the running for it."],
  ],
  paid: [
    ["Search terms first, everything else second", "Open the search terms report, sort by cost, and look only at the rows with no conversions. That list is your month's savings and it takes ten minutes."],
    ["One conversion action, not nine", "Counting every click as a conversion teaches the machine to buy clicks. Pick the one that means money and turn the others into secondary."],
    ["The landing page is usually the problem", "Cold traffic to a homepage converts badly no matter how good the targeting is. One page, one job, one form."],
    ["Broad match without a strong signal is a donation", "It works when the account already has conversion history to learn from. Before that it is an experiment you are paying full price for."],
    ["Track calls or you are guessing", "If the phone rings and nothing records it, half your results are invisible and you will switch off the thing that was working."],
  ],
  social: [
    ["The first second decides the rest", "Everything after the opening frame only matters if the opening frame stopped somebody. Shoot ten openings, use one."],
    ["Boosting a post that already worked beats a new ad", "The audience has already told you which one they liked. Pay to widen that, not to test a new guess."],
    ["Faces outperform product shots almost every time", "Especially on a small budget, a person talking to camera about the problem beats a polished shot of the thing."],
    ["Frequency kills more campaigns than targeting does", "The same three creatives for six weeks is why performance fell off, not the algorithm."],
    ["What works is in the comments", "Read every comment on your best post. The words people use there are the words your next ad should use."],
  ],
};
V2.freePost = function (opts = {}) {
  const room = opts.room || { sub: "smallbusiness" };
  const offer = opts.offer || V2.OFFERS[0];
  const type = V2.postType(opts.type || "playbook");
  const profile = opts.profile || {};
  const t = V2.tradeOf(room.sub, opts.campaign);
  const seed = String(opts.seed || (room.sub + "|" + type.key + "|" + offer.key));
  const bank = /local_seo/.test(offer.channel) ? "local" : /instagram|tiktok/.test(offer.channel) ? "social" : "paid";
  const pts = V2.FREE_POINTS[bank];
  const n = type.magnet ? 3 : 5;
  const start = V2.fnv(seed + "|pt") % pts.length;
  const points = Array.from({ length: n }, (_, i) => pts[(start + i) % pts.length]);
  const credit = profile.credit ? String(profile.credit).trim().replace(/\.$/, "") : "";
  const win = profile.wins ? String(profile.wins).trim().replace(/\.$/, "") : "";
  const open = V2.pick(V2.FREE_OPEN, seed, "open");
  const close = V2.pick(V2.FREE_CLOSE, seed, "close");
  const ask = V2.pick(V2.FREE_ASK, seed, "ask");

  if (type.magnet) {
    const title = `I will do ${offer.spots} of these for free this week — ${offer.name.replace(/^Free /, "").toLowerCase()} for any ${t.biz}`;
    const body = [
      `Doing this in the open so nobody has to take my word for it.`,
      credit ? `${credit.charAt(0).toUpperCase() + credit.slice(1)}.` : "",
      "",
      `Here is what you get:`,
      `1. ${offer.gift.charAt(0).toUpperCase() + offer.gift.slice(1)}.`,
      `2. The two things I would fix first, in the order I would do them.`,
      `3. Posted back into this thread, so everyone reading learns from it too.`,
      "",
      `What I need from you: ${offer.ask}. That is all — ${offer.risk}.`,
      "",
      `${offer.spots} spots. When they are gone I will say so in the comments and stop taking them.`,
      "",
      `While I am here, the thing I see most often on these is this. ${points[0][0]}. ${points[0][1]}`,
      "",
      `Drop yours below and I will work through them in order. ${ask}`,
    ].filter(Boolean).join("\n");
    return { title, body, first_comment: `One more that did not fit: ${points[1][0].toLowerCase()} — ${points[1][1]} Anyone seen that on theirs?`, from: "free" };
  }

  const titles = [
    `${n} things I keep finding wrong on ${t.biz} accounts, and what I do about each`,
    `The ${bank === "local" ? "local search" : bank === "paid" ? "paid ads" : "social"} checklist I run on every ${t.biz}, written out in full`,
    `What actually moved the ${t.units} for the ${V2.plural(t.biz)} I work with this year`,
    `If I had one afternoon to fix a ${t.biz}'s ${t.units}, this is the order I would do it in`,
  ];
  const title = V2.pick(titles, seed, "title");
  const body = [
    open,
    credit ? `${credit.charAt(0).toUpperCase() + credit.slice(1)}, so this is from opening a lot of them rather than from theory.` : "",
    win ? `The one I point at when people ask whether any of it matters: ${win}.` : "",
    "",
    ...points.flatMap(([h, d], i) => [`**${i + 1}. ${h}**`, d, ""]),
    close,
    "",
    ask,
  ].filter((x) => x !== undefined).join("\n");
  return { title, body, first_comment: `Happy to go deeper on any one of these if it is the one biting you. ${ask}`, from: "free" };
};

// Eight ideas, also for nothing: the shapes we have, crossed with the
// questions this campaign's rooms ask over and over.
V2.freeIdeas = function (campaign, seed) {
  const qs = (campaign && campaign.queries) || ["How do I get more customers", "Is an agency worth it", "Why did my leads drop", "What should I spend a month"];
  const t = V2.tradeOf("", campaign);
  const shapes = ["playbook", "mistakes", "result_story", "question_ask", "comparison", "teardown", "audit_magnet", "giveaway"];
  const s = String(seed || (campaign ? campaign.key : "all"));
  return shapes.map((shape, i) => {
    const q = qs[(V2.fnv(s + "|q" + i)) % qs.length];
    const type = V2.postType(shape);
    const title = shape === "question_ask" ? q + "?"
      : shape === "mistakes" ? `Five things I keep seeing ${V2.plural(t.biz)} get wrong, and the fix for each`
      : shape === "result_story" ? `What changed the ${t.units} for one ${t.biz} this year, with the numbers`
      : shape === "comparison" ? `${q} — what I have actually seen across a lot of these`
      : shape === "teardown" ? `Pull apart one ${t.biz}'s setup with me, anonymised`
      : shape === "audit_magnet" ? `Free look at your ${t.biz}, a few of them this week`
      : shape === "giveaway" ? `The checklist I run on every ${t.biz}, pasted in full below`
      : `${q} — the whole answer, written out`;
    return V2.ideaClean({
      title, angle: q, shape,
      room_kind: type.magnet ? "owner" : i % 2 ? "ads" : "owner",
      gives: "the method, in full, for nothing",
      hook: "", risk: type.magnet ? "it is an offer, so it needs a room that allows one" : "none",
    }, i);
  });
};

// ------------------------------------------------------- where they are
// Reddit does not hand out a country, but people give themselves away in
// every other line. This is free and deterministic, and it is what keeps the
// queue to the places where a lead is worth having — and it names each
// country specifically rather than lumping everything non-tier-one into one
// bucket, so a target can be any single country, not just "not India".
//
// Every token here has to be unambiguous. "PHP" was reading the programming
// language as the Philippine peso and throwing away a $3k-a-month buyer, so
// the peso is never matched by the language code, only by the country name,
// a city, or the phone code. "dong" and "taka" are ordinary-looking words
// too, so those only count sitting next to a digit. A currency code only
// counts next to a number; the language is never a country.
V2.COUNTRY = {
  us: { name: "United States", tier1: true, re: /\b(zip ?code|\d{5}(-\d{4})?\b|LLC\b|S-?corp|realtor|sidewalk|gasoline|HOA\b|IRS\b|W-?2\b|1099\b|DMV\b|401k)\b|\$\s?\d|\b(texas|florida|california|ohio|georgia|arizona|colorado|michigan|illinois|nevada|virginia|tennessee|oregon|utah|kansas|iowa)\b/i },
  uk: { name: "United Kingdom", tier1: true, re: /\bpost ?code\b|\bLtd\b|\bVAT\b|\bHMRC\b|\bcompanies house\b|\bhigh street\b|\bcouncil\b|\blimited company\b|£\s?\d|\b(london|manchester|birmingham|leeds|glasgow|bristol|liverpool|sheffield|edinburgh|cardiff|belfast|nottingham)\b/i },
  ca: { name: "Canada", tier1: true, re: /\bpostal code\b|\bGST\b|\bHST\b|\bCRA\b|\bprovince\b|\bloonie\b|\bCAD\b|C\$\s?\d|\b(toronto|vancouver|calgary|edmonton|ottawa|montreal|winnipeg|mississauga|hamilton|halifax|saskatoon)\b|\b(ontario|alberta|quebec|manitoba|saskatchewan|nova scotia|british columbia)\b/i },
  au: { name: "Australia", tier1: true, re: /\bABN\b|\bGST\b.*\baustralia|\bBAS\b|\bsuburb\b|\bAUD\b|A\$\s?\d|\b(sydney|melbourne|brisbane|perth|adelaide|canberra|gold coast|newcastle)\b|\b(nsw|qld|vic|wa|sa|nt|act)\b/i },
  in: { name: "India", tier1: false, re: /₹\s?\d|\binr\b\s?\d|\d\s?inr\b|\+91[\s-]?\d{2,}|\b(india|indian)\b|\b(bangalore|bengaluru|mumbai|new delhi|delhi ncr|hyderabad|chennai|pune|kolkata|gurgaon|gurugram|noida|ahmedabad|jaipur|lucknow|surat|indore|chandigarh)\b/i },
  pk: { name: "Pakistan", tier1: false, re: /\bpkr\b\s?\d|\d\s?pkr\b|\+92[\s-]?\d{2,}|\bpakistan(i)?\b|\b(karachi|lahore|islamabad|rawalpindi)\b/i },
  bd: { name: "Bangladesh", tier1: false, re: /\bbdt\b\s?\d|\d\s?bdt\b|\d\s?taka\b|\btaka\s?\d|\+880[\s-]?\d{2,}|\bbangladesh(i)?\b|\b(dhaka|chittagong)\b/i },
  ng: { name: "Nigeria", tier1: false, re: /\bngn\b\s?\d|\d\s?ngn\b|\bnaira\b|\+234[\s-]?\d{2,}|\bnigeria(n)?\b|\b(lagos|abuja)\b/i },
  ph: { name: "the Philippines", tier1: false, re: /\+63[\s-]?\d{2,}|\bphilippin(e|es)\b|\bfilipino\b|\b(manila|quezon city|\bcebu\b)\b/i },
  id: { name: "Indonesia", tier1: false, re: /\bidr\b\s?\d|\d\s?idr\b|\brupiah\b|\+62[\s-]?\d{2,}|\bindonesia(n)?\b|\b(jakarta|surabaya|bandung)\b/i },
  vn: { name: "Vietnam", tier1: false, re: /\bvnd\b\s?\d|\d\s?vnd\b|\+84[\s-]?\d{2,}|\bvietnam(ese)?\b|\b(hanoi|ho chi minh)\b/i },
  ke: { name: "Kenya", tier1: false, re: /\bkes\b\s?\d|\d\s?kes\b|\+254[\s-]?\d{2,}|\bkenya(n)?\b|\b(nairobi|mombasa)\b/i },
  np: { name: "Nepal", tier1: false, re: /\bnpr\b\s?\d|\d\s?npr\b|\+977[\s-]?\d{2,}|\bnepal(i|ese)?\b|\bkathmandu\b/i },
  lk: { name: "Sri Lanka", tier1: false, re: /\blkr\b\s?\d|\d\s?lkr\b|\+94[\s-]?\d{2,}|\bsri lanka(n)?\b|\bcolombo\b/i },
  // A bare rupee figure, "Rs. 5000", or "2 lakh" with no city or country
  // named is real money but not attributable to one of the above — India,
  // Pakistan, Nepal and Sri Lanka all write it the same way. Kept as its own
  // entry rather than guessed into one of them.
  other: { name: "an unnamed low-budget market", tier1: false, re: /\brs\.? ?\d|\b\d+\s?(lakh|crore)\b|\b(lakhs?|crores?)\b|\brupees?\b/i },
};
V2.COUNTRY_LIST = Object.entries(V2.COUNTRY).filter(([k]) => k !== "other").map(([key, c]) => ({ key, name: c.name, tier1: c.tier1 }));
V2.COUNTRY_SUB = { smallbusinessUK: "uk", AusSmallBusiness: "au", smallbusinesscanada: "ca", IndianStartups: "in" };
V2.countryOf = function (text, sub) {
  const t = String(text || "");
  if (sub && V2.COUNTRY_SUB[sub]) return { key: V2.COUNTRY_SUB[sub], ...V2.COUNTRY[V2.COUNTRY_SUB[sub]], why: "r/" + sub + " is a country's own room", sure: true };
  const hits = [];
  for (const [key, c] of Object.entries(V2.COUNTRY)) if (c.re.test(t)) hits.push({ key, ...c });
  if (!hits.length) return { key: "", name: "", tier1: null, why: "nothing in it says where they are", sure: false };
  // a low-budget signal — a named country, city, phone code, or an
  // unattributed rupee figure — always beats an incidental tier-one signal
  // like a bare dollar sign: someone freelancing out of Mumbai who quotes a
  // client in USD is still in Mumbai. Among the low-budget hits, a named
  // country or city beats the unnamed catch-all.
  const low = hits.filter((h) => h.tier1 === false);
  const named = low.find((h) => h.key !== "other");
  const pick = named || low[0] || hits[0];
  return { ...pick, why: pick.key === "other" ? "the money named is not a tier-one market, but no specific country is named" : "reads as " + pick.name, sure: hits.length === 1 };
};

// What "on target" means is a choice, not a fact — asked for explicitly so it
// says so on the tab rather than being buried in a checkbox. "off" keeps
// everyone; "tier1" is the four English-speaking markets; every other key is
// exactly one country, built from the list above so picking a target is not
// limited to the four already wired in as fixed modes.
V2.TIER_MODES = {
  off: { name: "no filter", test: () => true },
  tier1: { name: "US, UK, Canada, Australia", test: (c) => c.tier1 === true },
  ...Object.fromEntries(V2.COUNTRY_LIST.map((c) => [c.key, { name: c.name + " only", test: (x) => x.key === c.key }])),
};

// ------------------------------------------------------- the audit itself
// The offer is only free if producing it is free. Twenty audits written by a
// model is the cost back again, so this is the audit as a fixed shape a
// person fills in from Google Maps in a few minutes. Everything in it is
// public and takes no tool to read.
V2.AUDIT_KIT = {
  minutes: 6,
  need: "their business name and town, or the Maps link",
  steps: [
    { do: "Search their main service plus the town in an incognito window", find: "where they sit in the three-pack, or that they are not in it", note: "screenshot it — the screenshot is the whole proof" },
    { do: "Note the three profiles above them", find: "each one's primary category, review count and average", note: "this is the comparison that makes the audit land" },
    { do: "Open their profile and read the primary category", find: "whether it matches what the winners use", note: "the single most common fixable mistake" },
    { do: "Count their services and products listed", find: "how many of the things they sell are not listed at all", note: "every missing one is a search they cannot appear for" },
    { do: "Look at photo count and the date of the newest", find: "whether anything has been added this quarter", note: "easy, visible, and they can do it themselves" },
    { do: "Read the last ten reviews and count the replies", find: "reply rate, and whether replies name the service and the town", note: "the fix costs nothing and works" },
    { do: "Check the site the profile points at", find: "whether it loads fast on a phone and has the town in the title", note: "one line of advice, no redesign talk" },
  ],
  report: [
    "Where you rank right now for [their main service] in [town]: position N, or not in the pack.",
    "The three above you, and the one thing each has that you do not.",
    "Your primary category versus theirs.",
    "How many of your services are unlisted: N of M.",
    "Photos: N, newest [month].",
    "Reviews: N at X average, Y of the last ten answered.",
    "The two things I would fix first, in order, with why.",
  ],
  rules: [
    "Post it in the thread, not in a DM. The public one is the advertisement.",
    "Never say what you would charge. If they ask, answer in DM.",
    "Give the fixes away fully. Somebody doing it themselves is a person telling others where they got it.",
    "One screenshot beats three paragraphs.",
    "If the profile is already good, say so plainly and do not invent a problem. That one earns more trust than the rest.",
  ],
  reply: "Done — posted above. The two fixes are the category and the unlisted services, in that order. Anything there you want me to go deeper on?",
};

// A lead is only worth having if the money behind it is worth having.
// `mode` is one of V2.TIER_MODES ("off" / "tier1" / "us"); `strict` decides
// whether a post with no country signal at all is kept (the lenient default,
// so a US buyer who never mentions a city is not thrown away) or dropped
// (for someone who wants only confirmed matches and would rather miss a few
// than see anything unverified).
V2.tierScore = function (p, opts = {}) {
  const c = V2.countryOf([p.title, p.body, p.text].filter(Boolean).join(" \n "), p.sub);
  // opts.tier1Only is the old boolean shape, kept working: true means "tier1"
  const mode = opts.mode || (opts.tier1Only ? "tier1" : "off");
  const rule = V2.TIER_MODES[mode] || V2.TIER_MODES.off;
  if (mode === "off") return { ...c, keep: true };
  if (!c.key) return { ...c, keep: !opts.strict };   // nothing said, benefit of the doubt unless strict
  return { ...c, keep: rule.test(c) };
};

// ------------------------------------------ does this offer fit these people
// A Google Business Profile audit offered to r/roastmystartup is nonsense:
// those are founders with a product and no shopfront, and not one of them has
// a profile to audit. Word overlap never catches that, so the audience is now
// a gate of its own — asked before any score is calculated.
V2.AUDIENCES = {
  local: { name: "a business with an address or a service area", has: "a Google Business Profile, a map pin and a catchment" },
  ecom: { name: "an online store", has: "a catalogue, a cart and paid traffic" },
  b2b: { name: "a business selling to other businesses", has: "long cycles, few large contracts, no walk-ins" },
  founder: { name: "founders and makers", has: "a product, an idea, and usually no customers yet" },
  pro: { name: "marketers and agencies", has: "accounts of their own, and nothing to sell us" },
  mixed: { name: "a bit of everything", has: "no single shape" },
};
// The rooms whose audience is not what their kind would suggest.
V2.ROOM_AUDIENCE = {
  roastmystartup: "founder", SideProject: "founder", indiehackers: "founder", startups: "founder",
  Business_Ideas: "founder", SaaS: "b2b", microsaas: "founder", buildinpublic: "founder",
  ecommerce: "ecom", shopify: "ecom", shopifystore: "ecom", dropship: "ecom", Etsy: "ecom",
  FulfillmentByAmazon: "ecom", AmazonSeller: "ecom", AmazonPPC: "ecom", EcommerceMarketing: "ecom", ecommercemarketing: "ecom",
  msp: "b2b", sysadmin: "b2b", ITManagers: "b2b", staffing: "b2b", recruiting: "b2b", consulting: "b2b",
  logistics: "b2b", Manufacturing: "b2b", humanresources: "b2b", B2BForHire: "b2b", CommercialCleaning: "b2b",
  PPC: "pro", GoogleAds: "pro", FacebookAds: "pro", adwords: "pro", SEO: "pro", bigseo: "pro", TechSEO: "pro",
  marketing: "pro", DigitalMarketing: "pro", advertising: "pro", AskMarketing: "pro", agency: "pro",
  copywriting: "pro", adops: "pro", programmatic: "pro", GrowthHacking: "pro", socialmedia: "pro",
  SocialMediaMarketing: "pro", content_marketing: "pro", Affiliatemarketing: "pro", juststart: "pro",
  freelance: "pro", webdev: "pro", analyticsengineering: "pro", BusinessIntelligence: "pro", juniordev: "pro",
  LocalSEO: "pro", GoogleBusinessProfile: "mixed", smallbusiness: "mixed", smallbusinessadvice: "mixed",
  sweatystartup: "local", growmybusiness: "mixed", solopreneur: "mixed", business: "mixed",
  Entrepreneur: "mixed", EntrepreneurRideAlong: "mixed", Entrepreneurship: "mixed", Franchising: "local",
  smallbusinessUK: "mixed", smallbusinesscanada: "mixed", AusSmallBusiness: "mixed",
  forhire: "mixed", DoneDirtCheap: "mixed", Slavelabour: "mixed", hiring: "mixed", jobbit: "mixed",
  conversionoptimization: "pro", landingpage: "pro", landingpages: "pro", Emailmarketing: "pro",
  Emailmarketinghelp: "pro", Emailmarketingtips: "pro", MarketingAutomation: "pro", hubspot: "pro",
  YouTubeAds: "pro", TikTokAds: "pro", InstagramMarketing: "pro", FacebookAdvertising: "pro",
  PPCHelp: "pro", PPCMastery: "pro", SEOhelp: "pro", seogrowth: "pro", analytics: "pro",
  GoogleAnalytics: "pro", GoogleTagManager: "pro", Wordpress: "mixed", InsuranceProfessional: "local",
};
V2.audienceOf = function (room) {
  if (!room) return "mixed";
  const sub = typeof room === "string" ? room : room.sub;
  if (V2.ROOM_AUDIENCE[sub]) return V2.ROOM_AUDIENCE[sub];
  const kind = typeof room === "string" ? (V2.TARGETS.find((t) => t.sub === sub) || {}).kind : room.kind;
  return kind === "owner" ? "local" : kind === "ads" ? "pro" : "mixed";
};
// What an offer needs its reader to own. Anything not listed will take anyone.
V2.OFFER_NEEDS = {
  local_seo: ["local", "mixed"],
  meta_ads: ["local", "ecom", "mixed", "b2b"],
  instagram_tiktok: ["local", "ecom", "mixed"],
  google_ads_seo: ["local", "ecom", "b2b", "mixed"],
  none: null,
};
V2.audienceFit = function (offer, room) {
  const aud = V2.audienceOf(room);
  const needs = V2.OFFER_NEEDS[(offer && offer.channel) || "none"];
  const sub = typeof room === "string" ? room : room.sub;
  if (aud === "pro") {
    return { ok: false, aud,
      why: "r/" + sub + " is marketers and agencies — they run their own accounts and are not going to hire us. Answer there, never offer." };
  }
  if (!needs) return { ok: true, aud, why: "" };
  if (needs.includes(aud)) return { ok: true, aud, why: "" };
  const has = (V2.AUDIENCES[aud] || {}).has || "";
  const wants = (offer.channel || "").replace(/_/g, " ");
  return { ok: false, aud,
    why: "r/" + sub + " is " + (V2.AUDIENCES[aud] || {}).name + (has ? " — " + has : "") + ", so a " + wants + " offer has nothing to land on there" };
};

// ------------------------------------ finding the rooms from the evidence
// Better than any list we could write: search Reddit for the offer we intend
// to make, see where people have already made it, and count how many of
// those posts are still standing. The rooms that come back are the rooms
// where this works — including ones nobody thought to put on a list.
V2.OFFER_PHRASES = {
  local_seo: ["free google business profile audit", "free GBP audit", "free local seo audit", "free google maps audit",
    "drop your google maps link", "free map pack audit", "I will audit your google business profile"],
  google_ads_seo: ["free google ads audit", "free ppc audit", "free adwords audit", "free seo audit",
    "free landing page teardown", "free landing page review", "drop your website and I will"],
  meta_ads: ["free facebook ads audit", "free meta ads audit", "free ad account audit",
    "free ad account teardown", "I will review your facebook ads"],
  instagram_tiktok: ["free instagram audit", "free tiktok audit", "free ad creative review",
    "free creatives for your brand", "I will review your instagram"],
  none: ["free marketing plan", "free growth plan", "free 90 day plan", "free marketing audit"],
};
V2.GENERIC_PHRASES = ["free audit", "drop your link and I will", "I will audit", "offering free audits", "free teardown"];
V2.offerPhrases = function (offer, wide) {
  const own = V2.OFFER_PHRASES[(offer && offer.channel) || "none"] || V2.OFFER_PHRASES.none;
  return wide ? own.concat(V2.GENERIC_PHRASES) : own;
};
// Group what came back by room, and rank by what survived rather than by how
// many were posted — ten removed posts is a warning, not a recommendation.
V2.discoverRank = function (hits, known) {
  const by = {};
  for (const h of hits || []) {
    if (!h || !h.sub) continue;
    const b = (by[h.sub] = by[h.sub] || { sub: h.sub, posts: 0, survived: 0, removed: 0, comments: 0, best: null, authors: {} });
    b.posts += 1;
    if (h.removed) b.removed += 1;
    if (h.survived) b.survived += 1;
    b.comments += h.comments || 0;
    if (h.author) b.authors[h.author] = 1;
    if (!h.removed && (!b.best || (h.comments || 0) > (b.best.comments || 0))) b.best = h;
  }
  const rows = Object.values(by).map((b) => {
    const t = V2.TARGETS.find((x) => x.sub.toLowerCase() === b.sub.toLowerCase());
    return {
      ...b, authors: Object.keys(b.authors).length,
      known: !!t, kind: t ? t.kind : "", promo: t ? t.promo : "",
      audience: V2.audienceOf(t || b.sub),
      rate: b.posts ? Math.round((b.survived / b.posts) * 100) : 0,
      avg: b.posts ? Math.round(b.comments / b.posts) : 0,
      score: b.survived * 10 + Math.min(b.comments, 200) / 4 - b.removed * 6 + Object.keys(b.authors).length * 2,
    };
  });
  rows.sort((a, b) => b.score - a.score);
  return {
    rows,
    found: rows.length,
    newRooms: rows.filter((r) => !r.known && r.survived > 0).map((r) => r.sub),
    verdict: rows.length
      ? rows.filter((r) => r.survived > 0).length + " rooms have let a post like this stand, and " + rows.filter((r) => !r.known && r.survived > 0).length + " of them are not in the room list yet"
      : "nobody has posted anything like this anywhere Reddit will show us — which is either an opening or a warning",
  };
};

// ------------------------------------------- why is nothing coming through
// A scan that keeps nothing should say which gate ate everything, in the
// order a person would check: did we read anything at all, is a filter too
// tight, or is it simply that nobody is asking this week.
V2.funnelWhy = function (f) {
  const d = (f && f.drop) || {};
  const read = (f && f.read) || 0;
  const kept = (f && f.kept) || 0;
  const live = (f && f.live) || 0;
  const mode = V2.TIER_MODES[f && f.tierMode] || V2.TIER_MODES.tier1;
  const out = [];
  if (!read) {
    out.push({ bad: true, say: "no posts were read at all", fix: d.sources ? "Reddit did not answer — open a Reddit tab, make sure you are logged in, and scan again" : "every source came back empty, which usually means the Reddit tab is not logged in" });
    return { headline: "Nothing was read", lines: out, ok: false };
  }
  if (d.known >= read * 0.9 && kept === 0) {
    out.push({ bad: false, say: Math.round((d.known / read) * 100) + "% of what was read is already in the queue", fix: "nothing new has been posted since the last scan — this is normal an hour after one" });
  }
  if (d.country > 0 && d.country >= kept) {
    out.push({ bad: true, say: d.country + " were dropped for not being " + mode.name, fix: "change the market filter on this tab if that is too narrow" });
  }
  if (d.noMoney + d.selling > 0 && kept < 3) {
    out.push({ bad: false, say: (d.noMoney + d.selling) + " had no money signal — no budget, no agency, no business of their own", fix: "that filter is doing its job; it is what keeps students and freelancers out" });
  }
  if (live > 0 && kept === 0) {
    out.push({ bad: false, say: live + " are already waiting in the queue from earlier scans", fix: "work those first — the scan only adds what it has not seen" });
  }
  if (!out.length) out.push({ bad: false, say: kept + " kept out of " + read + " read", fix: "" });
  return {
    headline: kept ? kept + " new, " + live + " waiting" : live ? "nothing new, " + live + " still waiting" : "nothing kept",
    lines: out, ok: kept > 0 || live > 0,
  };
};
