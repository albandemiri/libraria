# Platform commission: design

Status: draft, awaiting approval. Date: 2026-11-13. Branch: `phase-2/commerce`.

## Why

Libraria provides the store, reader and payment handling, so it takes a
percentage of each sale. The rate is set per publisher contract, and different
publishers have different contracts. The split must also be visible for every
sale, because the publisher portal is meant to give publishers full financial
transparency (see the publisher dashboard requirement).

## Decisions

- **Same price on every channel.** A book costs the same on the web (Paddle) as
  in the iOS and Android apps. The publisher absorbs the higher store fee on
  mobile.
- **Base: option B, "for the time being".** The commission is a percentage of
  what is left after VAT and the payment fee:

  ```
  base      = price - VAT - provider fee        (today's transaction_items.net_cents)
  libraria  = floor(base * rate)
  publisher = base - libraria
  ```

  For example, a €10 book (after VAT) at 20%: on mobile Apple keeps €3,
  Libraria gets €1.40 and the publisher €5.60. On the web Paddle keeps about €1,
  Libraria gets €1.80 and the publisher €7.20.
- **The rate is configurable per publisher.** It is not a global constant.

## Goals

- Admins set each publisher's rate with a start date. A new contract adds a new
  rate. Past sales keep the rate they were made under.
- Every sold item stores the rate it used, Libraria's share and the publisher's
  share, so the books always reconcile:
  `price = VAT + provider fee + Libraria + publisher`.
- Publishers can see their current rate, their rate history and their earnings.
  They cannot change any of it.
- Refunds reverse both shares in proportion to the amount refunded.

## Non-goals

- Payouts to publishers (bank transfers, statements). That is a later project.
- Different rates per channel, tiered rates, or minimum fees. The data model
  should not rule these out, but they are not built now.
- In-app purchases. See "Next project" below.

## Anti-goals

- A publisher's earnings must never be computed with a rate other than the one
  stored on the sale.
- Sales must never go through with a silent 0% commission. A publisher with no
  rate cannot sell.
- The formula must not be duplicated across files. It lives in one function,
  so that changing the base later (A instead of B) is a one-place change for
  new sales.

## Approaches considered

1. **Dated rates per publisher, snapshotted on each sale (chosen).** This keeps
   history correct when contracts change, and every number on the dashboard
   traces back to a stored row.
2. **A single rate column on `publishers`.** Simpler, but changing it would
   silently change how past sales appear unless every sale copied it anyway. It
   also loses the contract history.
3. **Compute commission only at report time.** Nothing is stored per sale. This
   was rejected because publishers would see numbers change after a rate edit,
   which breaks the transparency goal.

## Design

**Data** (new migration `0004_platform_commission.sql`):

- `publisher_commission_rates`: `id`, `publisher_id`, `rate_bps` (an integer
  from 0 to 10000, where 2000 means 20%, so rates like 17.5% are possible),
  `effective_from`, `contract_reference` (optional free text), `created_by`
  (the admin user) and `created_at`. It is unique on
  `(publisher_id, effective_from)`. The rate in force at a given time is the
  row with the latest `effective_from` that is not after that time. Rows are
  never edited; a correction is a new row.
- `transaction_items` gains:
  - `commission_rate_bps`, snapshotted at checkout;
  - `platform_commission_cents` and `publisher_earnings_cents`, computed when
    the payment is confirmed and the fee is known;
  - `platform_commission_reversed_cents` and
    `publisher_earnings_reversed_cents`, which increase on refunds.
- There is no backfill of rates for existing publishers (we do not know their
  contracts). The dev seed and the test fixtures create a rate.

**Behaviour:**

- **Checkout** looks up each item's publisher rate at that moment and stores it
  on the item. If any publisher in the cart has no rate in force, checkout is
  refused with a new error code, `BOOK_NOT_FOR_SALE`, and no transaction is
  created.
- **Payment confirmed:** after `net_cents` is set, one function `splitEarnings`
  in `backend/src/commerce/` computes Libraria's share and the publisher's
  share. If the provider has not reported the fee, both shares stay null until
  it does.
- **Refund:** the shares reverse in proportion to `refunded_cents` divided by
  the unit price. A full refund reverses them exactly. Rounding favours the
  publisher.
- **Chargeback lost:** treated as a full refund, so both shares are reversed in
  full.

**API:**

- `POST /api/v1/admin/publishers/:id/commission-rates` and
  `GET /api/v1/admin/publishers/:id/commission-rates`: admin only. There is no
  admin router yet; this adds one.
- `GET /api/v1/publisher/contract`: the publisher's current rate and history.
- The publisher stats endpoints add the publisher's net earnings next to gross
  revenue.

**Tests:**

- Unit tests for `splitEarnings`: rounding, 0%, 100%, and a null fee.
- Integration tests:
  - a rate change does not alter past sales;
  - publishers cannot read or set other publishers' rates;
  - a non-admin cannot set a rate;
  - checkout is refused without a rate;
  - full and partial refund reversals;
  - a multi-publisher cart where each item uses its own publisher's rate;
  - `price = VAT + fee + Libraria + publisher` holds for every item.

## Calls made without asking (please check)

- Rates are stored in basis points, not as a decimal.
- The rate is captured at **checkout**, consistent with the price snapshot,
  rather than at payment confirmation. The two are minutes apart.
- Rounding goes in the publisher's favour, both on the sale and on refunds.
- With no rate in force, the publisher cannot sell. There is no 0% fallback.
- Libraria's share is not shown to readers.

## Left to the builder

- Exact column names and how the publisher earnings column is exposed in each
  stats query.
- Whether the provider fee itself is reversed on a refund. Record the fee as the
  provider reports it in the adjustment, if it does; otherwise leave the fee
  unchanged and note it.

## Next project: in-app purchases (not part of this design)

The iOS and Android apps will sell through App Store and Google Play in-app
purchases, and Paddle stays for the web and any desktop app. The recommended
approach is to verify purchases on our own server, without RevenueCat. That
choice is not yet confirmed, and it waits until Apple Developer and Google Play
Console accounts exist. The commission above already works for those channels,
because the store fee becomes the item's provider fee.
