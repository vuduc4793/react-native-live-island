# Wire format (v1)

`defineLiveActivity` serializes JSX into this JSON. Three renderers draw it: SwiftUI
(`ios-widget/DIRenderer.swift`), Android Views/RemoteViews (`android/`) and React Native
(`src/WireView.tsx`). Keys are short because iOS caps a Live Activity's state at **4 KB**.
The source of truth is `src/schema.ts`.

## Payload

| key | meaning |
|-----|---------|
| `v` | schema version (1) |
| `cp.l` / `cp.t` | compact leading / trailing |
| `mn` | minimal |
| `ex.l` / `ex.t` / `ex.c` / `ex.b` | expanded leading / trailing / center / bottom |
| `ls` | lock screen (iOS) and expanded notification (Android) |
| `nc` | Android collapsed notification. Defaults to `cp.l` + `cp.t` |
| `st.bg` / `st.kl` / `st.fc` | background / keyline / default text color |
| `url` | deep link opened when the activity is tapped |

## Nodes

Every node has a type `t`. It can also take these modifiers: `p` padding `[top,right,bottom,left]`,
`bg` background, `r` corner radius, `w`/`h` fixed size, `fx: 1` fill horizontally, `o` opacity.

| `t` | element | own keys |
|-----|---------|----------|
| `v` `h` `z` | VStack / HStack / ZStack | `c` children, `sp` spacing (default 6; ZStack has none), `a` alignment `s`/`c`/`e` (default `c`) |
| `tx` | Text | `v` text, `fs` size (15), `fw` weight `ul l r m sb b h`, `fc`, `ln` max lines, `ta` align, `mo` tabular digits, `rd` rounded |
| `tm` | Timer | `e` countdown target or `f` count-up start (epoch ms), text keys |
| `ic` | Icon | `n` SF Symbol / built-in alias, `an` Android drawable override, `s` size (16), `fc` |
| `im` | Image | `n` asset name, `cm` `fill`/`fit` |
| `sp` | Spacer | `s` min length |
| `pg` | Progress | `k` `bar`/`ring`, `v` 0..1 or `f`+`e` time range, `fc`, `tc` track, `s` ring size (20), `lw` thickness |

Colors are unsigned ARGB integers (`0xAARRGGBB`). Times are epoch milliseconds.

## Sending updates from your server (iOS push)

When you start an activity with `{ push: true }` (and ran `scripts/add-widget-target.rb --push`, which sets `LiveIsland_EnablePush` in Info.plist; the app also needs the Push Notifications capability / `aps-environment`),
the app receives a token through `addPushTokenListener`. To update the activity from a server,
send an APNs `liveactivity` push to that token. Put the JSON payload, as a string, in `content-state`:

```json
{
  "aps": {
    "timestamp": 1760000000,
    "event": "update",
    "content-state": { "payload": "{\"v\":1,\"cp\":{...}}" }
  }
}
```

To build that string on the server, use `react-native-live-island/src/core`. It exports the
primitives and `renderTemplate`/`encodePayload` and has no React Native dependency, so it runs in
Node with tsx or ts-node. Write the template object (a `LiveActivityTemplate`) in a file that imports
only from `src/core`. Your app then wraps that object with `defineLiveActivity(template)`, and your
server calls `encodePayload(renderTemplate(template, data))`.
