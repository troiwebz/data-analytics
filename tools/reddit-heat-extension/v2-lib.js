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
  { key: "gbp_audit", name: "Free Google Business Profile audit", channel: "local_seo",
    who: "any business with a physical location or a service area",
    gift: "where you rank for your main keyword, the three profiles sitting above you, what they have that you do not, and the two things I would fix first",
    ask: "drop your Maps link or business name and city",
    risk: "posted publicly in the thread — no email, no call, no signup",
    spots: 10 },
  { key: "ads_teardown", name: "Free ad account teardown", channel: "meta_ads",
    who: "anyone spending over $1,000 a month on Meta or Google",
    gift: "a walk through your structure, your worst-spending ad set, and the three changes I would make on Monday",
    ask: "share a screenshot of your last 30 days with the account name blurred",
    risk: "I post the teardown in the thread so everyone learns from it",
    spots: 5 },
  { key: "local_pack", name: "Free local pack report", channel: "local_seo",
    who: "local service businesses fighting for map positions",
    gift: "a grid of where you actually rank across your city, not just from your own office chair, plus who owns the squares you are losing",
    ask: "business name and city",
    risk: "the report is yours whether or not we ever speak again",
    spots: 10 },
  { key: "free_build", name: "We build it free, you only pay the ad spend", channel: "meta_ads",
    who: "businesses that have never run paid ads properly",
    gift: "campaign build, audience, tracking and the first creative set at no cost — you pay the platform, not us",
    ask: "tell me the business and what a new customer is worth to you",
    risk: "if month one does not beat what you are doing now, we stop and you owe nothing",
    spots: 3 },
  { key: "pay_on_results", name: "Pay per booked lead, no retainer", channel: "google_ads_seo",
    who: "owners burned by a monthly retainer that produced nothing",
    gift: "we carry the setup and the management cost",
    ask: "agree a price per booked call before we start",
    risk: "no lead, no invoice",
    spots: 3 },
  { key: "creative_pack", name: "10 ad creatives, free, you run them", channel: "instagram_tiktok",
    who: "brands whose ads have gone stale",
    gift: "ten scroll-stopping IG and TikTok concepts scripted and edited for your product",
    ask: "send a link to what you sell",
    risk: "run them yourself, keep them forever, pay only if you want the next batch",
    spots: 5 },
  { key: "landing_fix", name: "Free landing page teardown", channel: "google_ads_seo",
    who: "anyone sending paid traffic to a page that does not convert",
    gift: "a line-by-line teardown of the page your ads point at and the rewrite I would ship first",
    ask: "post the URL",
    risk: "public teardown, no strings",
    spots: 10 },
  { key: "seo_gap", name: "Free competitor keyword gap report", channel: "google_ads_seo",
    who: "businesses being out-ranked and not sure why",
    gift: "every search your top competitor ranks for that you do not, sorted by what those searches are worth",
    ask: "your site and one competitor",
    risk: "you keep the file",
    spots: 10 },
  { key: "dead_leads", name: "We work your dead lead list free", channel: "meta_ads",
    who: "anyone sitting on months of old enquiries that went cold",
    gift: "we write and run the reactivation sequence over your existing list",
    ask: "export the list",
    risk: "you pay only on jobs booked from it",
    spots: 3 },
  { key: "90_day_plan", name: "Free 90-day growth plan, written, no call", channel: "none",
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
        },
        required: ["name", "angle", "who", "gift", "ask", "risk", "spots", "channel", "why_it_works"],
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
    "An offer is irresistible when three things are true: the value arrives before the invoice, the risk sits on us rather than on them, and the thing we ask back is smaller than the thing we give.",
    "",
    "Rules for every offer you write:",
    "- The gift must be a concrete deliverable a stranger can picture. 'Where you rank for your main keyword and the three profiles above you' is an offer. 'A free consultation' is not.",
    "- The ask must be one small public thing: a link, a business name, a screenshot. Never a call, never an email address, never a form.",
    "- No prices, no packages, no discounts, no 'limited time'. Scarcity is a number of spots, nothing else.",
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
  const all = [o && o.name, o && o.gift, o && o.ask, o && o.risk].join(" ");
  if (!o || !o.name || o.name.length < 6) bad.push("it has no real name");
  if (!o.gift || o.gift.length < 25) bad.push("the free part is too vague to picture");
  if (!o.ask || o.ask.length < 8) bad.push("there is no ask");
  if (!o.risk || o.risk.length < 12) bad.push("it does not say why saying yes is safe");
  if (/\$\s?\d|\bprice|\bpackage|\bdiscount|\b\d+% off/i.test(all)) bad.push("it mentions money or a package");
  if (/book a call|hop on a call|schedule a call|jump on a call|free consultation|discovery call/i.test(all)) bad.push("it asks for a call, which is not a small ask");
  if (/email address|your email|sign ?up|fill (in|out) (the|a) form/i.test(all)) bad.push("it asks for an email or a form");
  if (/https?:\/\/|www\./i.test(all)) bad.push("it contains a link");
  const spots = Number(o.spots || 0);
  if (!(spots >= 3 && spots <= 15)) bad.push("the number of spots is not believable");
  return bad;
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
    made: true, at: Date.now(),
  };
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

V2.postUser = function (target, offer, type, profile = {}, extra = "") {
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
V2.NO_PROMO_RE = /no (self[- ]?promo|promotion|advertis|soliciting|spam)|self[- ]?promo(tion)? (is )?(not allowed|prohibited|banned|forbidden)|do not (advertise|promote|solicit)|no ads\b|advertising is not allowed|not a place to (advertise|promote)|banned: ?(promo|advertis)/i;
V2.WEEKLY_RE = /(weekly|monthly|sticky|pinned|megathread|designated) (self[- ]?promo|promo|advertis|thread)|promo(tion)? thread|self[- ]?promo(tion)? (thread|saturday|sunday|monday)|only in the (weekly|monthly|sticky|pinned)/i;
V2.OK_PROMO_RE = /self[- ]?promo(tion)? (is )?(allowed|welcome|encouraged|fine|ok)|promotion is allowed|advertising (is )?allowed/i;
V2.promoFromRules = function (rules, submitText, description) {
  // accepts Reddit's raw shape and the trimmed one the board stores
  const text = [(rules || []).map((r) => [r.short_name, r.name, r.description, r.what, r.violation_reason].filter(Boolean).join(" ")).join(" \n "), submitText || "", description || ""].join(" \n ");
  if (!text.trim()) return null;
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
