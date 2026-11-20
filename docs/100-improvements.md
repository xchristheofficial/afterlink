# AfterLink: 100 improvements

This tracker starts after the call playback controls and group topics. Checked means implemented and tested on the working branch, **not** deployed. Unchecked items are planned outcomes, not feature announcements. Work in small batches; preserve permissions and test with two accounts for shared features. Revisit the ordering after device testing.

### Message delivery and catch-up
- [x] 001 Retry a group or Linkback send after a lost acknowledgement without duplicating the message.
- [x] 002 Retry a watch-chat message without generating a second DM.
- [x] 003 Keep group messages unread behind a modal or while reading history; offer a jump back to the latest message.
- [x] 004 Compose multiline group and Linkback messages with Shift+Enter without accidentally submitting during IME composition.
- [x] 005 Only offer an earlier group-history page when another visible message actually exists.
- [ ] 006 Preserve loaded group history as new messages arrive, reconciling any changes in visibility.
- [x] 007 Automatically reconcile a failed optimistic DM after connectivity returns while the page remains open.
- [x] 008 Show a per-conversation first-unread divider when reopening a DM.
- [x] 009 Open a DM inbox filtered to unread conversations only.
- [x] 010 Let members pin favorite conversations privately at the top of their inbox.

### Calls on real devices
- [ ] 011 Switch between front and rear cameras during a connected call.
- [ ] 012 Select an available microphone without redialing.
- [x] 013 Pick a speaker or headset on browsers supporting audio output selection.
- [ ] 014 Warn locally when a selected microphone disconnects and offer recovery.
- [x] 015 Answer with the microphone muted from the outset.
- [x] 016 Expose a manual low-data video mode independent of network hints.
- [x] 017 Show a local connection-quality estimate based on measured RTC statistics.
- [x] 018 Offer redial after a failed connection without resending an invitation automatically.
- [x] 019 Distinguish a declined call from an unanswered call in the caller's UI.
- [x] 020 Add an optional locally enabled incoming ring sound with a silent fallback.

### Watching and recording
- [x] 021 Switch the shared tab without ending the presentation where the browser supports it.
- [x] 022 Tell the presenter whether their selected tab actually includes audio.
- [x] 023 Let the presenter pause tab-sound transmission separately from the microphone.
- [x] 024 Expand the shared content while keeping an accessible route back to chat.
- [x] 025 Offer a user-gesture playback recovery control when the guest's tab stream cannot autoplay.
- [x] 026 Show an unread watch-chat indicator when its conversation pane is collapsed.
- [x] 027 Show elapsed recording time to both participants.
- [x] 028 Warn the recorder shortly before hitting the local recording limit.
- [x] 029 Provide a second local download opportunity if the first recording download is dismissed.
- [x] 030 Explain what will and won't be captured before requesting recording consent.

### Finding and managing messages
- [x] 031 Filter conversation search by sender.
- [x] 032 Narrow conversation search to a date range.
- [ ] 033 Make text matching handle Unicode case folding in private search.
- [x] 034 Search joined group messages without exposing results to invitees.
- [x] 035 Browse kept photos and GIFs from the open DM without opening view-once media.
- [x] 036 Jump directly to a chosen calendar date in a long DM.
- [x] 037 Copy a text message from its action menu with clipboard-denied fallback.
- [x] 038 Add private message bookmarks with access rechecked when revisiting them.
- [ ] 039 Allow a sender to correct a text DM with a visible edited label.
- [ ] 040 Reply to a group message with a permission-checked quotation.

### Groups and invitations
- [x] 041 Let an administrator explicitly hand off administration to a joined member.
- [x] 042 Show the current member and pending-invite count against the group limit before selection.
- [x] 043 Search the member roster by name inside group details.
- [ ] 044 Expire old pending invitations without removing joined members.
- [ ] 045 Allow a member to silence one group's activity badges while keeping its messages.
- [ ] 046 Archive a group privately without leaving it.
- [x] 047 Show a preview of which invitations will be cancelled before an admin leaves.
- [ ] 048 Prevent concurrent admin edits from silently overwriting group details.
- [ ] 049 Show opt-in typing presence in joined group chats without identifying pending invitees.
- [x] 050 Open a pinned group decision in its surrounding conversation.

### Composer and attachments
- [x] 051 Paste a supported image from the clipboard into the DM attachment preview.
- [x] 052 Drop a supported image into a conversation without navigating away.
- [x] 053 Show the processed attachment size before sending.
- [x] 054 Warn before leaving a page with an unsent attachment.
- [x] 055 Provide a remaining-character indicator near the text limit.
- [x] 056 Offer a searchable list of recently used emojis on this device with a clear option.
- [x] 057 Show microphone input activity while capturing a voice note.
- [x] 058 Choose a voice-note playback rate without changing call audio.
- [x] 059 Warn before the voice-note duration limit cuts capture short.
- [ ] 060 Allow cancellation of a pending attachment upload with clear delivery reconciliation.

### Feed, discovery and profiles
- [x] 061 Return to the previous reading position when backing out of a feed post.
- [x] 062 Collapse long captions with an accessible expand control.
- [x] 063 Navigate a post's media gallery with the keyboard.
- [ ] 064 Allow authors to supply alternative text for new post images.
- [x] 065 Preserve discovery filters when opening a result and returning.
- [x] 066 Offer a following-only activity filter in notifications.
- [x] 067 Let members mark only the currently selected notification category as read.
- [x] 068 Add keyword filtering within a private saved collection.
- [x] 069 Provide an accessible focal-point choice for profile photos.
- [x] 070 Let users copy a canonical profile link without tracking parameters.

### Privacy and account controls
- [x] 071 Offer a preview of a profile as seen by a non-follower.
- [ ] 072 Make clearing private nicknames a single confirmed settings action.
- [x] 073 Show a searchable blocked-member list for large accounts.
- [ ] 074 Allow revoking one other signed-in session instead of all other sessions.
- [ ] 075 Explicitly revoke lingering live-event connections on logout.
- [x] 076 Warn before a privacy change broadens an existing post's audience.
- [x] 077 Offer an authenticated download of the member's own profile settings.
- [x] 078 Clear sensitive client-side previews when session expiry redirects to login.
- [x] 079 Add a review step explaining the effect of deleting an account on group ownership.
- [ ] 080 Allow members to discard all outstanding recovery sessions after a successful password change.

### Accessibility and small screens
- [x] 081 Restore focus to the invoking message after closing its action sheet.
- [x] 082 Add a skip link directly to the active conversation composer.
- [x] 083 Make new-message announcements useful without re-announcing message history.
- [x] 084 Keep the active composer reachable as the mobile on-screen keyboard opens.
- [x] 085 Give call mute state a persistent text indicator in the minimized dock.
- [x] 086 Let users reposition the minimized call away from the active input.
- [x] 087 Keep long display names from pushing call controls off narrow screens.
- [x] 088 Respect forced-colors settings for unread badges and selected chips.
- [x] 089 Preserve visible focus across live group member-list updates.
- [x] 090 Surface recoverable form errors beside the affected field and link them for screen readers.

### Reliability and operations
- [x] 091 Automate a backup-to-fresh-database restore drill against disposable data.
- [x] 092 Add an operator storage-health check that does not expose filesystem paths publicly.
- [ ] 093 Test an interrupted schema migration against a copy of an older database.
- [ ] 094 Measure inbox query cost against a representative large synthetic conversation set.
- [x] 095 Avoid overlapping unread-count requests on slow connections.
- [x] 096 Reconcile group events received during an in-flight refresh instead of dropping the wake-up.
- [x] 097 Add repeatable browser coverage for reconnect after server-sent event interruption.
- [x] 098 Verify downloaded recordings decode to playable media, not just nonempty files.
- [x] 099 Add a real-device release checklist for calls on separate mobile networks using TURN.
- [x] 100 Document rollback and data-preservation checks for releases that add SQLite columns.
