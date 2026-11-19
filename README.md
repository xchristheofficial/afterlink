# AfterLink · a product of Kodra

Reference-led account access page. The left panel is noninteractive artwork from the supplied design, not a feed or a source of database records. The right panel is a responsive HTML form. The application starts with no accounts or content. See [PRODUCT.md](PRODUCT.md) for the product proposal.

## Run

Node 22.13 or newer (built-in SQLite), `npm ci`, then `npm start`. The app serves the page and API from one origin on port 3000. Run `npm test` for the isolated authentication integration test; it never touches the live database.

For browser checks, install Chromium with `npx playwright install --with-deps chromium`, then run `npm run test:ui`. The script starts a separate service with a temporary database, exercises the actual page, and removes the database afterward.

## Accounts

Select **Sign up** and enter a full name, unique username (3–30 letters, numbers, or underscores), email and password of at least 12 characters. Both forms share one decorative image. Sign in with email and password. Existing accounts remain usable without a username. Phone is an optional contact field, not SMS verification. Email/password accounts do not claim the address has been verified. After login the home feed shows real persisted activity.

Accounts and revocable, seven-day sessions are stored in `data/afterlink.sqlite`. Passwords use salted scrypt hashes; session tokens are random, hashed in storage and held in HTTP-only cookies in the browser. Never commit or serve the data directory. Run behind HTTPS with `NODE_ENV=production` to require secure cookies. Use a persistent volume and backups for the database in a deployed single-instance service; a workspace preview is not production hosting.

## Home feed

Signing in opens `/home`, the bookmarkable, session-protected Home Feed. Opening `/home` while signed out returns you to sign-in. The responsive feed opens with a post composer, people search, follow/unfollow, follower counts and saved posts. The latest 50 posts by the viewer or accounts they follow are shown newest first. All records and counts start empty. Story, messaging, and notification surfaces are reserved for future pages and do not simulate activity.

The first account in this SQLite database (lowest user ID) is bound once to the **RADAR** public display name and developer badge. This changes neither its credentials nor its username, and grants no permissions. Other accounts use their own profile details; public directory and feed responses exclude emails and phone numbers. Keep the database on persistent storage to retain this association. Site transitions are opt-in via the browser’s no-reduced-motion preference.

## Create Post

Open `/create` from the Home Feed or your empty profile. Write up to 500 characters, choose Everyone (signed-in members) or Followers, attach up to ten photos/GIFs or one MP4/WebM video, add a two-answer poll, a feeling, or a typed place. Uploads are limited to 8 MB per post and 128 MB of published media per member. Media, votes, and one private saved draft per member use the same persistent SQLite database as posts. **Drafts** lets you explicitly save, reopen, replace, or delete your draft. Following status and account privacy apply to the feed, shared profiles, saved posts, votes and direct media requests. Nothing is posted until Publish succeeds.

## Profiles

Open **Profile** from the home sidebar, or select a name in a post or Explore People. `/profile` shows your account; `/profile/<id>` is a stable link you can share with other members. Bios and display-name edits are persisted for the signed-in owner. RADAR’s public founder name and badge cannot be changed through this form. The profile grid lists the latest 50 posts while the count covers all posts. Saved posts are only available to their owner. Reels and Tagged have empty states until those features exist. Motion enhancements respect reduced-motion preferences.

### Edit Profile

`/profile/edit` edits the signed-in account. Photos are center-cropped on the device before saving. Usernames are checked case-insensitively and the sign-in email is read-only. Email and phone are not sent in other members’ profiles. Enabling Private Account limits posts to existing followers and pauses new follows; it does not hide the directory listing. Deleting an account requires typing `DELETE`, removes its posts, saves, follows, recovery tokens and sessions, and retires its profile ID and founder designation.

## Settings

- `PORT` — default `3000`.
- `DB_FILE` — override database location (including its filename).
- `TRUST_PROXY_HOPS` — only set to a known/trusted reverse-proxy hop count for client IP rate limiting.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` — optional web OAuth client settings. Register the exact public HTTPS callback URL ending in `/auth/google/callback` with Google. Supply secrets via server environment, never frontend code. Without all three settings, the button explains that Google sign-in is not configured. With credentials, the flow checks state, uses PKCE, verifies the ID token and its verified-email claim, and identifies returning Google users by subject. It does not silently merge with a password account using the same email. Provider connectivity is required at runtime.

## Password recovery

**Forgot password?** opens the email form without reloading the illustration. To deliver reset emails, set `RESEND_API_KEY` (server secret), `RESET_FROM_EMAIL` (a sender verified with Resend), and `RESET_PUBLIC_ORIGIN` (the public HTTPS origin of this deployment) on the web service. Never commit the API key. With these settings absent, the form explicitly reports that no link was sent. Check the provider’s delivery logs when enabling email and disable provider click tracking for reset links.

Links expire in 15 minutes, contain a random single-use token in the URL fragment, and are replaced on resend after a one-minute cooldown. Only token hashes are stored. Requests return the same acknowledgment for eligible, unknown, and Google-only addresses. The reset form requires matching passwords of 12–128 characters with at least one uppercase letter and one number. A successful password reset revokes existing sessions; the user signs in again.

## Launch checklist

Before public launch, configure production storage/TLS, recovery delivery and email verification, operational monitoring, and Kodra-approved legal and support information. The brief information dialogs describe this implementation, not a comprehensive production policy. Moderation controls are needed before opening public posting broadly. Messaging is not implemented.
