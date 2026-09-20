# BUSINESS: og-image-api

**Buyer:** indie developers, blog/newsletter owners, small SaaS teams, Next.js/Astro agencies who need per-page social cards without running Puppeteer.
**Problem:** every blog post or product page needs a good `og:image`; designing them by hand doesn't scale and self-hosting a headless browser is heavy.

## Pricing

| Plan     | Cards/month | MAD | USD |
| -------- | ----------- | --- | --- |
| Free     | 100         | 0   | 0   |
| Pro      | 10,000      | 99  | 9   |
| Business | 100,000     | 349 | 35  |

## First 5 customers

1. Post a "generate OG images with one URL" demo on Dev.to / Hashnode / r/webdev with the free tier; convert commenters.
2. Offer to set up OG images for 5 open-source docs sites or indie SaaS landing pages via a PR (Next.js `generateMetadata` snippet), free for a month.
3. Cold-message Moroccan/French-speaking freelancers and small agencies on LinkedIn/X who build WordPress/Next sites; sell as a white-label component in their client work.

## Accounts needed to go live

Hosting with a persistent disk (Fly.io/Railway/VPS), a domain, Stripe (or Paddle/LemonSqueezy; Stripe is not available for Moroccan businesses directly, so check Paddle/LemonSqueezy or a foreign entity) to sell plans. Today keys are minted manually via the admin endpoint; self-serve signup + billing is not built.

## Honest limits

- No self-serve signup/billing/dashboard yet.
- Latin text only; no logo/image embedding (deliberately avoided: it would need SSRF protection).
- Crowded market (Vercel OG is free, Bannerbear, Cloudinary). Differentiate on price, simplicity and Arabic/French support once RTL fonts are added.
