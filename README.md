# AfterLink · a product of Kodra

Reference-led account access page. The left panel is noninteractive artwork from the supplied design, not a feed or a source of database records. The right panel is a responsive HTML form. The application starts with no accounts or content. See [PRODUCT.md](PRODUCT.md) for the product proposal.

## Run

Node 22.13 or newer (built-in SQLite), `npm ci`, then `npm start`. The app serves the page and API from one origin on port 3000. Run `npm test` for the isolated authentication, recovery, and social settings tests; it never touches the live database.

For browser checks, install Chromium with `npx playwright install --with-deps chromium`, then run `npm run test:ui`. The script starts a separate service with a temporary database, exercises the actual page, and removes the database afterward.

## Accounts

Select **Sign up** and enter a full name, unique username (3–30 letters, numbers, or underscores), email and password of at least 12 characters. Both forms share one decorative image. Sign in with email and password. Existing accounts remain usable without a username. Phone is an optional contact field, not SMS verification. Email/password accounts do not claim the address has been verified. After login the home feed shows real persisted activity.

Accounts and revocable, seven-day sessions are stored in `data/afterlink.sqlite`. Passwords use salted scrypt hashes; session tokens are random, hashed in storage and held in HTTP-only cookies in the browser. Never commit or serve the data directory. Run behind HTTPS with `NODE_ENV=production` to require secure cookies. Use a persistent volume and backups for the database in a deployed single-instance service; a workspace preview is not production hosting.

## Home feed

Signing in opens `/home`, the bookmarkable, session-protected Home Feed. Opening `/home` while signed out returns you to sign-in. The responsive feed opens with a post composer, people search, follow/unfollow, follower counts and saved posts. The latest 50 posts by the viewer or accounts they follow are shown newest first. All records and counts start empty. Stories, the inbox, and the activity center use real member data.

The first account in this SQLite database (lowest user ID) is bound once to the **RADAR** public display name and developer badge. This changes neither its credentials nor its username, and grants no permissions. Other accounts use their own profile details; public directory and feed responses exclude emails and phone numbers. Keep the database on persistent storage to retain this association. Site transitions are opt-in via the browser’s no-reduced-motion preference.

## Create Post

Open `/create` from the Home Feed or your empty profile. Write up to 500 characters, choose Everyone (signed-in members) or Followers, attach up to ten photos/GIFs or one MP4/WebM video, add a two-answer poll, a feeling, or a typed place. Uploads are limited to 8 MB per post and 128 MB of published media per member. Media, votes, and one private saved draft per member use the same persistent SQLite database as posts. **Drafts** lets you explicitly save, reopen, replace, or delete your draft. Following status and account privacy apply to the feed, shared profiles, saved posts, votes and direct media requests. Nothing is posted until Publish succeeds.

## Profiles

Open **Profile** from the home sidebar, or select a name in a post or Explore People. `/profile` shows your account; `/profile/<id>` is a stable link you can share with other members. Bios and display-name edits are persisted for the signed-in owner. RADAR’s public founder name and badge cannot be changed through this form. The profile grid lists the latest 50 posts while the count covers all posts. Saved posts are only available to their owner. The Reels tab shows video posts. Tagged has an empty state until tagging is implemented. Motion enhancements respect reduced-motion preferences.

### Edit Profile

`/profile/edit` edits the signed-in account. Photos are center-cropped on the device before saving. Usernames are checked case-insensitively and the sign-in email is read-only. Email and phone are not sent in other members’ profiles. Enabling Private Account limits posts to existing followers and pauses new follows; it does not hide the directory listing. Deleting an account requires typing `DELETE`, removes its posts, saves, follows, recovery tokens and sessions, and retires its profile ID and founder designation.

## Social pages

- **Messages** (`/messages`, `/messages/<member-id>`): choose a real member to start a conversation. Search the inbox by name or message, send text or a compressed photo, and see unread counts and read receipts. Open threads refresh every 4.5 seconds while visible. Earlier messages can be loaded in batches. Only the sender and recipient can fetch a message photo. Messages are stored in SQLite, not end-to-end encrypted; no simulated support accounts, online status, or voice/video calls.
- **Explore** (`/search?q=…`): People, Posts, and Reels filters search member names, handles, captions and post locations. Results respect current post visibility. No placeholder posts or view counts are inserted.
- **Reels** (`/reels`): real video posts, with play/pause, seeking, volume, fullscreen (browser permitting), unique member views, likes, comments, shares and saves. Publish a video in Create Post to appear here. The share count counts distinct members who copied or shared a link through the share control, not recipients.
- **Post detail** (`/post/<id>`): open from the feed, search results, a profile, notification or reel. Read comments, reply, like, or share the stable link; the link does not grant access. Text-only posts display their text instead of a stock photograph.
- **Notifications** (`/notifications`): follows, post likes, comments, replies and visible `@username` mentions. Filter activity, follow back, open the referenced item or mark all read. Profile visits and individual saves are not disclosed.
- Motion uses short entry/interaction transitions and respects the device’s reduced-motion setting. `npm run test:ui` exercises these screens with isolated accounts, including a third-party privacy check and a real short WebM generated at test time. Optional `SOCIAL_SCREENSHOTS` names a directory for review images.

## Linkbacks

Open **Post options → Start a Linkback** on a post or reel, optionally write an opening message, then choose people to invite. **Messages → Linkbacks** lists your recent groups and invitations separately from direct messages. **Your Linkbacks** on a post lists only your own groups about it. A post author has no special access to other people’s conversations. Copying a group link does not invite anyone.

Invitees must accept before seeing the conversation, participant list, or pinned decision. Select a message to preview and pin it above the conversation. Details lets the admin invite or remove members and resend or cancel pending invitations. If the admin leaves, the longest-standing remaining member becomes admin. Leaving also cancels your outstanding invitations; groups with no remaining members close.

Original post previews use the current viewer’s post permissions rather than storing a copy. A deleted or newly private post is replaced by an unavailable state while group messages and decisions remain. Blocking a member leaves groups you share with them. Invitations respect blocks and the recipient’s messaging preferences. Linkbacks are private to their participants, **not end-to-end encrypted**.

The inbox shows the latest 100 groups/invitations; search matches the visible post, latest message, pinned decision, inviter, or group number. Threads load in batches of 60 messages and refresh while visible. Each group supports up to 30 participants including outstanding invitations.

## Member settings and stories

Open **Settings** from navigation to search account, privacy, notification and appearance controls. Notification preferences affect new in-app activity, not historical notices; push and email notifications are not delivered. Appearance includes system/light/dark mode, accent color, reduced motion and separate video and reel autoplay preferences. All screens use the same surface and action colors from `public/theme.css`; saved appearance changes carry across navigation and open tabs. Media backdrops remain neutral for legibility.

Profile counts open searchable follower/following lists. **Saved** shows your private bookmarks and collections. Use **Report or Block** on another member’s profile or post to report, block, mute or unfollow. Reports are stored for operator review; there is no automated moderation decision or moderator dashboard. Blocked and muted accounts can be managed in Privacy & Safety.

**Create Story** supports a photo, video or provided background, plus caption, audience and reply controls. Stories expire after 24 hours. Replies and quick reactions go to the author’s inbox and require messaging permission.

**Account & Security** lists active sessions, lets password users change their password, and offers authenticator-based two-factor sign-in with single-use recovery codes. To enable enrollment, provision `AFTERLINK_2FA_KEY` as a stable secret (32 random bytes encoded as base64; generate with `openssl rand -base64 32`). Back it up separately from the database. Do not regenerate it on restart or commit it. Without it, new enrollment is unavailable. Google-only accounts use their provider for sign-in security.

## Server configuration

- `PORT` — default `3000`.
- `DB_FILE` — override database location (including its filename).
- `TRUST_PROXY_HOPS` — only set to a known/trusted reverse-proxy hop count for client IP rate limiting.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` — optional web OAuth client settings. Register the exact public HTTPS callback URL ending in `/auth/google/callback` with Google. Supply secrets via server environment, never frontend code. Without all three settings, the button explains that Google sign-in is not configured. With credentials, the flow checks state, uses PKCE, verifies the ID token and its verified-email claim, and identifies returning Google users by subject. It does not silently merge with a password account using the same email. Provider connectivity is required at runtime.

## Password recovery

**Forgot password?** opens the email form without reloading the illustration. To deliver reset emails, set `RESEND_API_KEY` (server secret), `RESET_FROM_EMAIL` (a sender verified with Resend), and `RESET_PUBLIC_ORIGIN` (the public HTTPS origin of this deployment) on the web service. Never commit the API key. With these settings absent, the form explicitly reports that no link was sent. Check the provider’s delivery logs when enabling email and disable provider click tracking for reset links.

Links expire in 15 minutes, contain a random single-use token in the URL fragment, and are replaced on resend after a one-minute cooldown. Only token hashes are stored. Requests return the same acknowledgment for eligible, unknown, and Google-only addresses. The reset form requires matching passwords of 12–128 characters with at least one uppercase letter and one number. A successful password reset revokes existing sessions; the user signs in again.

## Launch checklist

Before public launch, configure production storage/TLS, recovery delivery and email verification, operational monitoring, and Kodra-approved legal and support information. The brief information dialogs describe this implementation, not a comprehensive production policy. Assign operators to review stored reports and define an escalation policy before opening posting and messaging broadly.
