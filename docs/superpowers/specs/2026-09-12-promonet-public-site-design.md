# PromoNET Public Site Design

## Objective

Create a public, responsive offer storefront that is served by the existing Node.js backend, reads published offers from the existing PostgreSQL database, and redirects visitors to the affiliate destination while recording clicks.

## Scope

- One public homepage with a trustworthy storefront visual direction.
- Search, category filters, sorting, and paginated offer cards.
- Cards show image, marketplace, title, current price, optional original price, calculated discount, and update time.
- Only records with a confirmed publication and a valid HTTPS affiliate URL are visible.
- A first-party redirect route records a click and returns an HTTP 302 to the stored affiliate URL.
- A visible affiliate advertising disclosure and a WhatsApp community call-to-action.
- Responsive desktop and mobile layouts, keyboard navigation, accessible labels, loading, empty, and recoverable error states.
- No authentication, administration panel, favorites, alerts, or user profiles in the first release.

## Architecture

The existing `bot` process remains the single backend. It serves static frontend assets from `site/`, exposes read-only public offer endpoints, and accesses PostgreSQL through the existing pool. The collector remains the only writer of offers and affiliate links.

### Public API

- `GET /api/offers?q=&category=&sort=recent|discount&page=&limit=` returns only published offers. Input is bounded and parameterized.
- `GET /api/categories` returns categories that currently have published offers.
- `GET /oferta/:nicheId/:itemId` validates the stored destination, records a click without blocking navigation, and responds with `302` plus `Cache-Control: no-store`.

### Data

The existing `promonet.offer_previews` and `promonet.offer_publications` tables remain the source of truth. A new `promonet.offer_clicks` table stores publication identity, timestamp, a random anonymous request identifier, and a coarse referrer host when valid. It does not store IP addresses, cookies, or browser fingerprints.

## Experience

The approved visual direction is “Vitrine confiável”: white and soft-gray surfaces, navy hierarchy, orange calls to action, green savings indicators, rounded but restrained cards, and real product imagery. The first viewport exposes search, category chips, a compact trust message, and current offers. Mobile uses a two-column card grid where space permits and a single column on narrow screens.

## Data Flow

1. The collector validates an offer, generates the tagged affiliate URL, sends it to WhatsApp, and marks it `published`.
2. The homepage requests published offers from the backend.
3. The backend returns safe display fields and an internal redirect URL, never database internals.
4. A visitor selects “Ver oferta”.
5. The backend records the click and redirects to the stored `https://meli.la/...` or approved marketplace URL.

## Safety and Failure Handling

- SQL uses parameters; query, filter, page, and limit values are bounded.
- Redirects are limited to HTTPS Mercado Livre and `meli.la` hosts already accepted by the project URL policy.
- Invalid or missing offers return 404; invalid destinations return 410; database failures return a fixed 503 response.
- Frontend text is rendered as text, not HTML, and broken images use a local neutral fallback.
- Affiliate disclosure is always visible near the offer grid.

## Verification

- Unit tests cover query parsing, public response mapping, filtering, redirect validation, click recording, and failure responses.
- Integration-level router tests cover API and static fallback behavior.
- Frontend behavior tests cover search/filter URL state and rendering helpers.
- Final checks include the full existing test suite, container build, HTTP smoke checks, responsive visual inspection, and accessibility basics.
