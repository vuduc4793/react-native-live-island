# Changelog

## 0.1.1 (2026-10-26)

### Android
- **Fix: app killed on Android 11 and lower when the run notification is a foreground service notification.**
  The custom notification views called `TextView.setGravity`, which RemoteViews only allows from API 31.
  SystemUI could not inflate the notification (`Couldn't inflate contentViews`). Android silently drops a plain
  notification in that case, but for a foreground service notification it kills the app
  (`RemoteServiceException` / `CannotPostForegroundServiceNotificationException`). Text and timer alignment
  now comes from layout variants, and opacity is only applied on API 31+.
- Every custom notification is inflated locally before it is posted. If inflation fails, the library uses the
  standard notification template instead (title, text, chronometer and progress, derived from the template).
- Crash tripwire: if the app dies while posting a custom foreground notification, custom views are disabled
  for foreground notifications on that device until the app version changes.
- New `getAndroidNotificationHealth()` and the `androidNotificationStyle: 'auto' | 'standard'` option
  (in `start()` or `configure()`).

## 0.1.0 (2026-10-21)

- First release: pure TurboModule (no Expo), iOS Live Activities + Dynamic Island, Android live
  notification / foreground service / floating island, in-app island, `scripts/add-widget-target.rb`.
