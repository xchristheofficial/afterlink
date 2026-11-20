# 30 upgrades in one batch

Twelve complete entries in the original 100-item tracker. The other eighteen are additional improvements, not replacements for unfinished tracker entries. This batch changes browser code and tests only; it uses the existing authenticated APIs and requires no database migration.

| # | Where | What changed |
|---:|---|---|
| 1 | Notifications → Notification tools | Show unread notices only. |
| 2 | Notifications → Mark shown as read | Mark only the unread rows in the selected category and current filters, not the entire inbox. Applies to the loaded notices (up to 100). **#067** |
| 3 | Notification tools → Time period | Limit activity to the past 24 hours, 7 days or 30 days. |
| 4 | Notification tools → Refresh notifications | Fetch new activity without losing the category, audience or time filters. |
| 5 | Notifications → Mark read | Clear one notice without opening its destination. |
| 6 | Notifications | Get a live count of shown and unread results as filters and read states change. |
| 7 | Saved → Saved library tools | Find saves that aren't in any collection. |
| 8 | Saved library tools → Sort saved posts | Sort by newest saved, oldest saved or author. |
| 9 | Saved library tools → Attachment type | Filter for photos, video or text-only posts across the selected library view. |
| 10 | Saved → Find collections by name | Search collection names separately from their contents. |
| 11 | Saved post card | Open the author's profile directly from a saved item. |
| 12 | Saved library tools → Hide media previews | Browse titles and authors without rendering thumbnails in the filtered list. |
| 13 | Reels → Playback settings | Choose playback speed and keep it when moving to another reel. |
| 14 | Reels → Playback settings | Loop a reel until you choose another. |
| 15 | Reels player | Go to the previous or next reel without finding its thumbnail. |
| 16 | Reels | Pause the current player when the page moves to the background. |
| 17 | Reels → Focus on player | Hide the reel list while keeping playback and navigation controls. |
| 18 | Reels → Mute reel sound | Carry the mute setting between players during the visit. Browser autoplay restrictions still apply. |
| 19 | DM → Conversation details → Conversation library | Browse kept photos and GIFs, with earlier history on demand. View-once items are never opened by this tool. **#035** |
| 20 | DM → Message actions → Bookmark on this device | Keep up to 100 message IDs per member and chat, with no message body in storage. Open or forget them from Conversation library; opening requests authorized context again. **#038** |
| 21 | Conversation library → Jump to date | Jump to an available message on a local calendar date without replacing the live conversation. Includes messages without captions. **#036** |
| 22 | DM, group and Linkback composers | Adjust for the mobile visual viewport when the keyboard opens without stealing focus or fighting pinch zoom. **#084** |
| 23 | Watch together | Request the browser's native tab-switching control when sharing a tab. On supporting browsers use **Share this tab instead**; unsupported browsers can still stop and reselect. **#021** |
| 24 | Joined group → Search group history | Search authorized messages one page at a time; pending invitations do not grant search access. **#034** |
| 25 | Group → View decision in context | Read a pinned decision with up to four preceding visible messages. Rechecks the pin before showing it. **#050** |
| 26 | Own profile → Preview as non-follower | Review the public profile, without saved items or follower-only posts. A private account previews no posts. Uses the current profile feed, not a simulation of a specific blocked account. **#071** |
| 27 | Profile → Posts / Reels | Filter the loaded profile feed by caption without adding terms to the URL. |
| 28 | Session expiry | When a protected page detects an expired session and redirects, remove sensitive page previews, close dialogs, and release active media first. **#078** |
| 29 | Messages → Local call options | Opt in to a short incoming tone for this page visit. The visual invitation works without sound. **#020** |
| 30 | Local call options → Use less call data | Opt into lower video capture and sender targets on the next call, including tab sharing, regardless of network hints. The preference is device-local. **#016** |

## Verification

`npm run test:thirty` drives the actual browser interfaces against disposable in-memory HTTP fixtures. `test:watch-layout` also exercises the capture request and cancellation; `test:call-dock` checks the requested low-data camera constraints on a simulated fast network. Set `CHROMIUM_PATH` if using a system Chromium. These checks do not run the production server, open SQLite, verify speakers or keyboards on physical phones, or automate the browser-owned tab picker.
