# AfterLink — made by Razorbill

Product proposal · 19 November 2026 · not an implemented feature list

**Positioning:** A social network for what happens *after* someone shares a post.

## What to borrow, and where to differ

| Source | Documented behavior | Proposed decision for AfterLink |
| --- | --- | --- |
| Instagram | Following and Favorites let people catch up chronologically. [1](https://about.fb.com/news/2022/03/two-new-ways-to-control-your-instagram-feed/) | Keep Following chronological. Never fill it with recommendations when someone follows nobody. |
| Instagram | Collaborative collections already connect shared posts to chats. [5](https://about.fb.com/news/2022/12/sharing-features-on-instagram-notes-group-profiles-and-more/) | Don't treat sending or saving a post as the differentiator. Help people remember what they decided to do about it. |
| TikTok | For You learns from interactions and negative feedback. [1](https://newsroom.tiktok.com/en-us/how-tiktok-recommends-videos-for-you) TikTok also explains why individual videos were suggested. [2](https://newsroom.tiktok.com/en-us/learn-why-a-video-is-recommended-for-you) | Give discovery its own space. Start with recent public clips from topics a person chooses; offer “Less like this.” No invented popularity scores or implied personalization on day one. |
| WhatsApp Web | WhatsApp's multi-device design synchronizes chat history and state across companion devices. [1](https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/) WhatsApp also distinguishes personal chats from public updates. [2](https://about.fb.com/news/2025/06/helping-you-find-more-channels-businesses-on-whatsapp/) | Make it easy to resume a conversation from another signed-in browser. Keep private activity out of public engagement counts. Don't promise end-to-end encryption without an implemented and reviewed protocol. |

## Signature feature proposal: Linkback

Suppose you discover a clip about an upcoming gig. Start a **Linkback** on that clip and invite the friends you might go with. The conversation stays attached to the original post, but its participants and messages aren't visible to the creator or other viewers. Pin the group's decision (for example, where to meet). Reopen the post or your inbox later to find the decision without searching a chat history. Different groups can have separate Linkbacks on the same post.

Sharing a post must not grant access to private media. If the original is deleted or the audience changes, stop displaying it to anyone without access; members can still read their own conversation. Invitations should require acceptance, respect blocks, and never automatically subscribe people to the creator.

## First-user and delivery rules

- A fresh install has zero accounts, posts, invitations, conversations and engagement. Registration creates real accounts; displayed records and counts come from persisted, authorized actions.
- No imported competitor accounts, staged chats, stock avatars posing as users, invented trends, or sample videos. When a feed has no content, offer to create a post or invite someone. Distinguish an empty feed from a failed request.
- Work one page at a time. Ask for the page's image before designing it. Use the image for layout, type, spacing and responsive behavior, not as a source of user records. If it depicts populated content, implement the layout but show an honest empty state until real records exist.
- Suggested first page: account access (sign up / sign in), so subsequent pages can be tested with a real identity. The owner chooses the order.
