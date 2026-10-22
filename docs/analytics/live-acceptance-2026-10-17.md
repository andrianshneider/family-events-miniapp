# Live PostHog acceptance — 17 October 2026

Existing organization **FamilyEvents**, existing **Default project** (670592), **US Cloud**. Dashboard: [Family Events — MVP Product Dashboard](https://us.posthog.com/project/670592/dashboard/2223265).

## Configuration and publication

The owner signed in through Chrome. The visible project token was transferred directly to an ignored local file and encrypted Vercel Preview variables; it was never printed, committed or embedded in the browser. POSTHOG_HOST=https://us.i.posthog.com, POSTHOG_ENVIRONMENT=non-production, POSTHOG_PROJECT_KEY configured only for branch infrastructure-foundation. No personal/broad API key, new PostHog project or database data source was created.

Initial configured redeploy dpl_CgKGHdh2F8CJYGBiWpsekrti6M5v was READY. Existing staging alias reassigned to it; the alias had initially still pointed at the earlier unconfigured deployment. Privacy fix a646033 then published as dpl_8Bzoxm5ULWFhDuFyLkdaqvngR9td, READY, with the staging alias verified and both CI runs39044021310/39044018221 successful. Main/Production unchanged, Production capture hard-off.

## Actual delivery and identity

| Check | Actual PostHog readback |
|---|---|
| Initial journal/export |15 rows,15 distinct UUIDs; per-event counts matched the committed journal |
| First RSVP / reservation after repeated requests |1 rsvp_submitted,1 gift_reserved |
| Anonymous Guest → verified Organizer |1 canonical PostHog person,2 distinct aliases |
| Guest view / RSVP / reservation |1 common internal Event UUID |
| First-touch transfer into own creation |1 attributed event_created |
| Initial canary / URL defaults |0 private-text canaries,0 URL/referrer defaults |
| Synthetic current-day NSM QA |Active1; Engaged P0 lower-bound1 |
| Synthetic RSVP QA |viewed1,started1,full funnel1,short funnel1 |
| Synthetic wishlist QA |full viewer1,reservation1 |
| Privacy follow-up |2 new rows,2 masked IPs,0 non-placeholder IPs,0 URL defaults,0 canaries |
| Total export checkpoint |17 sent; pending/processing0 |

These are actual PostHog SQL UI queries over actual SDK ingestion, not a mocked transport ACK. The SQL diagnostic scopes were synthetic/current-day only; maturity bypass used for this QA was never saved to product dashboard queries. HMAC logins were synthetic staging fixtures, not physical Telegram UI acceptance. SDK/transaction rollback/outage/mixed-account tests remain documented in verification.md.

The live receiver attached server egress IP to the initial15 synthetic events despite disabled GeoIP. No Guest IP was read or forwarded. The exporter now forces `$ip=0.0.0.0`; actual two-row follow-up verified this mask. Project Privacy → **Discard client IP data** was additionally enabled and PostHog confirmed success. The initial15 synthetic receiver-IP metadata records were not silently rewritten or deleted. Autocapture/replay/browser enrichment remain absent; no user text, private invitation locator, authentication token or Guest cookie was sent.

## Dashboard readback

12 named HogQL insights created, executed and read back in the dashboard. Source definitions: dashboard-posthog-v1.json; saved IDs and aggregate QA: live-posthog-readbacks.json. The exact historical first-party reference remains dashboard-v1.json (PostgreSQL); it is not mislabeled as HogQL.

Product filters are schema1.0 / staging / external, with28 full Europe/Moscow days. Synthetic/staff/unknown excluded from product funnels; labeled coverage remains separate. Guest joins preserve canonical actor+Event, cross-actor distribution uses Event-level joins. Preview/full/management separate; RSVP/detail are not booking prerequisites. Exact and rolling D7 separate. No fake sent-invitation counts, open rates or K-factor.

First-organizer conversion in PostHog is explicitly **observed P0 history**, with incomplete knowledge of pre-P0 Organizer history. Exact earlier ownership/creation checks remain in the first-party PostgreSQL reference, without exposing the private database to PostHog. Full Engaged/notification/detail/intent/repeat90–180d metrics need P1/history/retention; those are not fabricated. An empty or zero-denominator mature cohort is not presented as a measured0% conversion. Current-day synthetic data does not populate the default28-full-day product cards.

## Cleanup and remaining scope

Synthetic application users, Events, Gift, RSVP/reservation, idempotency receipts, Organizer/Guest sessions, visitor mappings and analytics journal were removed with exact ID/time/owner guards after delivery/readback. No real user subscription/message changed. Synthetic PostHog evidence intentionally retained and filtered out of product metrics.

No new schema migration in this follow-up (existing24 tables), scheduler retained. All13 P0 contracts remain implemented. P1/P2, physical iPhone/PWA/system Share and actual Telegram flows are separate from this hosted/provider verification. Automated first-party erasure/retention maintenance and vendor retention policy still require completion before Production; no longer retention approval or purge job is claimed here. Production remains disabled.
