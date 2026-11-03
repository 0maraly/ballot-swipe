# Ballot Swipe (nationwide)

Enter a street address, get that address's ballot as swipeable cards. Ballot data comes from the
[Google Civic Information API](https://developers.google.com/civic-information). A small server function keeps your API key
private and trims the response to what the page needs.

```
public/index.html   the app (static, no build step)
api/ballot.js       Vercel serverless function: POST /api/ballot {address, electionId?}
lib/ballot.js       Civic API calls + normalizer + validation + rate limit
server.js           local dev server
test/               unit tests (npm test) and browser smoke test
```

## Try it without a key

```
npm run demo          # http://localhost:3000, serves a fictional sample ballot
```

## Get a key and run it for real

1. Go to Google Cloud Console, create a project, enable **Civic Information API**.
2. Credentials → Create credentials → API key. Restrict it to the Civic Information API.
3. Locally: `GOOGLE_CIVIC_API_KEY=your_key npm start`
4. Deploy: push this folder to GitHub, import it in Vercel, add `GOOGLE_CIVIC_API_KEY` under Project → Settings →
   Environment Variables. Never put the key in code or in the page.

## Before you promote it

- Read Google's terms for the Civic Information API (display, attribution, caching) and follow them. I did not find them in the docs I could open.
- Coverage depends on the Voting Information Project data for each election and place. Expect gaps, especially in local races and measure descriptions.
- Rate limit is per-instance memory and best-effort. For heavy traffic add a shared limiter (Vercel KV/Upstash) and watch the 25,000/day quota.
- Do not add request logging or analytics that capture the request body; the address is the sensitive part.

## Tests

```
npm test                                  # backend
DEMO=1 PORT=3111 node server.js &         # then:
NODE_PATH=$(npm root -g) node test/smoke.js   # needs playwright
```
