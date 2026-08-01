# Vercel deployment evidence

Verified 2026-08-01 against the `jjl-advisors/mediamogul` Vercel project.

## Release topology

- Production alias: `https://mediamogul.vercel.app`
- Production artifact: `main` at `f303466`
- Continuation preview: `https://mediamogul-ow3bx31xx-jjl-advisors.vercel.app`
- Preview artifact: `agent/recover-foundation-and-e61` at `6e69c4e`
- Both remote builds completed successfully with Next.js 16.2.12 and TypeScript.
- Production `/`, preview `/style`, and preview `/manifest.webmanifest` returned HTTP 200.

## Remaining account setup

The Vercel project is not connected to GitHub. Vercel rejected the repository link
because the authenticated account does not yet have a GitHub Login Connection. Until
that account-level connection is added, branch pushes cannot create previews and main
merges cannot deploy production automatically.

No Vercel environment variables are configured. The required names remain documented
in `.env.example`. Runtime probes fail closed as intended:

- TMDB search returns HTTP 503 `provider-unconfigured` without `TMDB_API_KEY`.
- The recommendation route returns HTTP 503 `unconfigured` without its server secrets.

Secret values must be entered directly in Vercel for the appropriate environments;
they must never be committed or pasted into this document.

