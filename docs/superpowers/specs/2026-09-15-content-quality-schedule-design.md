# PromoMega Content Quality, Schedule, and Branded Cards Design

**Date:** 2026-09-15  
**Status:** Approved

## Objective

Improve the WhatsApp offer feed so that it publishes a varied selection of desirable non-food products, avoids equivalent products appearing repeatedly under different listings or affiliate links, runs only during the agreed daily window, and presents every offer with a consistent PromoMega-branded square image.

## Scope

This change covers the automated Mercado Livre collection and WhatsApp publication pipeline. It includes category coverage, offer selection, persisted deduplication, scheduling, image composition, affiliate-link validation, delivery behavior, logs, and administrator alerts.

It does not redesign the public storefront, add another marketplace, change the WhatsApp destination, or introduce an external image-generation service.

## Operating Schedule

- Run the collector every 20 minutes.
- Permit collection and publication daily from 07:00 through 22:59:59 in `America/Sao_Paulo`.
- Do not start a collection round at or after 23:00 or before 07:00.
- Do not accumulate missed rounds while the system is quiet.
- At 07:00, resume with one normal round rather than replaying a backlog.
- Apply the named time zone explicitly so that VPS or container UTC settings do not alter the schedule.

## Collection and Category Coverage

The collector remains general-purpose and must cover multiple commercial niches, including:

- clothing;
- fashion accessories;
- footwear;
- tools;
- electronics;
- home and kitchen;
- beauty and personal care;
- sports and fitness;
- baby products;
- automotive products;
- toys and games;
- other relevant non-food categories supported by the existing collector.

Food and beverages must be excluded before ranking and publication. The exclusion should use category information when available and normalized title signals as a defensive fallback.

Search definitions must include clothing and accessories rather than treating footwear as the only fashion category. Search rotation must ensure that less frequent categories remain eligible instead of allowing consistently high-volume categories to dominate every round.

## Ranking and Diversity

Each round may publish up to 10 offers. Candidates are ranked using the signals already available to the application, extended to balance:

- discount quality;
- product relevance or popularity;
- commercial desirability;
- category diversity;
- image availability and quality;
- successful affiliate-link generation.

No more than two published offers in one round may come from the same niche. Selection should use a round-robin or quota-aware pass over ranked candidates so that the category cap does not merely truncate the candidate list.

The selector should favor recognizable or commonly desired products without requiring a brittle static allowlist. Examples such as sneakers, clothing, tools, electronics, home products, and fitness products describe the desired breadth rather than mandatory inventory in every round.

## Persisted Deduplication

The deduplication window is seven days and must survive process and container restarts. A candidate is rejected if any of these persisted identities match a successfully published offer within the window:

1. marketplace item ID;
2. canonical product or destination URL;
3. normalized product fingerprint.

### Conservative Product Fingerprint

The normalized fingerprint represents the product's brand and meaningful model or product family. Its purpose is to catch equivalent items exposed under different listings, tracking parameters, short links, or affiliate links.

Normalization should:

- lowercase and remove accents and punctuation;
- normalize whitespace;
- discard sales phrases, quantities that describe bundles, and common listing noise;
- remove color, apparel size, and capacity tokens when they are only variants of the same base item;
- preserve identifiers that distinguish genuinely different models or generations;
- combine the normalized brand with the remaining model or product-family tokens.

The algorithm must remain conservative. Uncertain matches are allowed rather than suppressing distinct products. Exact item and canonical URL matching remain authoritative.

Deduplication is checked before affiliate-link creation and checked again immediately before delivery. A successful delivery writes the relevant identities atomically enough to prevent a retry or overlapping worker from sending the same offer again.

## Branded Offer Image

The backend generates a deterministic 1080×1080 image using Sharp. Playwright and external image-rendering services are not required.

The approved visual style is option A, “Produto em destaque”:

- white or very light gray background;
- rounded PromoMega logo near the top;
- fixed central product area;
- original product aspect ratio preserved using contain-style fitting;
- no stretching and no destructive crop of important product content;
- green discount badge;
- smaller struck-through previous price when valid;
- prominent current price;
- dark footer with green PromoMega accents;
- consistent margins and typography across all offers.

Remote source images are downloaded and decoded by the backend, then embedded in the generated card. The generated square image is sent to Evolution API as media data or through the project's existing supported upload mechanism.

If the source image is unavailable, invalid, or cannot be composed, the offer is skipped. The system must not publish a text-only substitute as part of this flow because consistent visual presentation is an explicit requirement.

## WhatsApp Caption

The caption continues to contain:

- the required advertising disclosure;
- product title;
- previous and current price when available;
- percentage discount when valid;
- the verified affiliate link.

Text remains the accessible source of offer information; important pricing and destination details must not exist only inside the image.

## Affiliate-Link Safety

The system must create or validate the affiliate link before publication. If authenticated link creation fails, it must not fall back to publishing an ordinary marketplace URL.

Cookie or session expiry is treated as a distinct operational incident. The affected candidates are not delivered until affiliate-link creation works again.

## Delivery, Retries, and Idempotency

- A failure affecting one candidate does not abort the entire round.
- An offer is recorded as successfully sent only after Evolution API confirms delivery acceptance.
- Technical retries are bounded and use progressive delay.
- Deduplication is rechecked before every retry.
- A stable delivery idempotency key should be derived from the destination and product identity when supported by the surrounding implementation.
- Overlapping collector rounds must not publish the same product twice.

## Administrator Alerts

Operational alerts are sent through WhatsApp to `5543991724961`.

Cookie/session expiry triggers one alert per active incident, not one alert per product or round. The incident remains open while failures continue. A successful authenticated affiliate-link creation resolves it automatically so that a future independent expiry can generate a new alert.

Connection failures, media composition failures, and affiliate authentication failures must be distinguishable in logs. Only failures that require user action should trigger the cookie-replacement notification.

## Observability

Each collection round records at least:

- candidates discovered;
- candidates rejected as food or beverage;
- candidates rejected by exact deduplication;
- candidates rejected by product fingerprint;
- candidates rejected by category quota;
- candidates skipped because of image failure;
- candidates skipped because of affiliate-link failure;
- offers successfully delivered;
- delivery failures.

Logs must include a round identifier and enough non-secret product identity to trace decisions. Cookies, API keys, authorization headers, and full session values must never be logged.

## Configuration

The following values should be configurable with safe defaults matching the approved behavior:

- interval: 20 minutes;
- time zone: `America/Sao_Paulo`;
- daily start: 07:00;
- daily end: 23:00 exclusive;
- maximum offers per round: 10;
- maximum offers per niche per round: 2;
- deduplication retention: 7 days;
- administrator WhatsApp number: `5543991724961`.

## Testing Strategy

Automated tests must cover:

- schedule boundaries in the configured time zone, including a UTC-hosted process;
- no backlog after the quiet period;
- food and beverage exclusion;
- clothing and accessory category inclusion;
- per-niche quota and rotation;
- exact item and canonical URL deduplication;
- conservative fingerprint matches and important non-matches;
- persisted deduplication across a simulated restart;
- duplicate prevention across retry or overlapping execution;
- 1080×1080 image output;
- contain fitting for portrait, landscape, and square product images;
- failed image behavior;
- prevention of non-affiliate fallback links;
- one alert per cookie-expiry incident and automatic incident recovery;
- successful Evolution delivery before sent-state persistence.

## Acceptance Criteria

The feature is complete when:

1. the deployed collector runs every 20 minutes only between 07:00 and 23:00 Brasília time;
2. a round publishes no more than 10 offers and no more than two from any one niche;
3. food and beverages are not published;
4. clothing and accessories appear in the eligible search rotation;
5. equivalent products with different listing or affiliate links are suppressed for seven days without broadly suppressing distinct models;
6. deduplication remains effective after a restart and under overlapping execution;
7. every published offer uses the approved 1080×1080 PromoMega card;
8. no ordinary marketplace link is published when affiliate-link creation fails;
9. cookie expiry sends a single actionable WhatsApp alert to the administrator and automatically resets after recovery;
10. automated tests and a representative end-to-end dry run demonstrate the behavior without exposing secrets.

