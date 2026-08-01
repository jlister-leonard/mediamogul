# Fandango showtimes link evidence

Checked 2026-08-01 against Fandango-owned pages.

- Fandango's [`/search`](https://www.fandango.com/search) page supports a title
  query and returns matching movies. Nightstand therefore uses only
  `https://www.fandango.com/search?q=<exact title>`.
- Fandango publishes ZIP-indexed movie-time pages such as its
  [ZIP directory](https://www.fandango.com/movietimes/movies-by-zipcode) and
  location pages shaped like `/<zip>_movietimes`. Those pages are location
  lists, not an official title-plus-ZIP deep-link contract.
- No Fandango-owned developer, help, or current affiliate material found in
  this review documents `zip` as a supported `/search` parameter, nor a stable
  URL that combines an external title with a ZIP.

Consequently the saved ZIP remains local. Nightstand does not append the
previously guessed `&zip=` parameter, does not manufacture a title slug, and
does not rely on a cookie-setting side channel. The complete "exact title's
nearby showtimes using stored ZIP" acceptance criterion remains blocked until
Fandango publishes a stable contract or supplies a title identifier/API.
