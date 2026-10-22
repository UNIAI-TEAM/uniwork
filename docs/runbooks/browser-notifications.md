# Browser system notifications

Scope: UNI-1965. The web workspace now invites the person to enable system
notifications. The browser permission dialog runs only after their click. The
notification settings page also offers a test while server push is unavailable.

## Two delivery paths

- An open workspace receives realtime events and can display system banners
  for new chat messages, mentions, assignments, meeting invitations/reminders
  and incoming calls. Browser permission must be granted. A visible browser
  behind another application is unfocused. Incoming-call banners close when
  the call ends, is answered or the app regains focus.
- A registered Web Push subscription can receive notifications after the tab
  is closed. The server now includes browser subscriptions for incoming calls,
  retaining the ringing check and short call TTL. Open workspaces with a push
  subscription leave the system banner to that path to avoid duplicates.

## Enable background push in a deployment

1. Provision one stable VAPID key pair in the deployment's secret manager.
   Configure `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` on the **Go backend**.
   Both are required. Set `VAPID_SUBJECT` to the deployment origin or its
   contact `mailto:` address. Do not put private keys in public frontend
   variables, source files, screenshots or logs. Keep the same pair across
   backend instances and restarts.
2. Restart the backend, then refresh an authenticated browser. Verify
   `GET /api/v1/notifications/push/config` reports `enabled: true` with a public
   key. This branch does not provision or change production secrets.
3. From the workspace invitation, click **Turn on notifications** and allow the
   browser request. If permission was already granted, enable **Receive push
   notifications in this browser** in Settings → Notifications. Registration
   must create `/sw.js`, a browser PushSubscription and a successful
   `POST /api/v1/me/push-subscriptions`.
4. Use HTTPS outside localhost. Verify both site permission and the browser's
   OS notification settings. Focus assist / Do Not Disturb can hide banners
   even when browser permission is granted. Do not describe a permission grant
   or a mocked constructor test as proof that the OS displayed a banner.

## Manual acceptance

Use consenting test accounts and synthetic messages; do not send messages to
production coworkers as a test.

- Windows Chrome/Edge and macOS Chrome/Safari: permission starts undecided, the
  invitation alone does not trigger a browser dialog, and its button does.
- Send a test from Settings and inspect the actual OS notification center.
  A rendered settings success message alone is insufficient evidence.
- With the app unfocused, send a new message and a call from another test
  account. Selecting the system banner opens the correct conversation. Answer
  or end the call and verify its open-page banner closes.
- Check meeting reminders, muted rooms, permission denial and an existing
  granted permission. Browser settings must remain available after dismissing
  the invitation.
- With server push configured and the browser registered, close the tab and
  repeat. Delivery with the browser process fully quit depends on the browser
  and OS. Chat pushes retain the existing recent-activity suppression policy;
  allow that window to expire when verifying closed-tab chat delivery.
