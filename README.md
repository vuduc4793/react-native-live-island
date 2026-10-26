# react-native-live-island

Viết giao diện **một lần bằng JSX**, thư viện tự render ra mọi nơi:

| Bề mặt | iOS | Android | Trong app (cả 2) |
|---|---|---|---|
| Island thu gọn (compact) | Dynamic Island thật (Live Activity) | Island nổi bao quanh camera (overlay) | Island vẽ bằng React Native |
| Island mở rộng (expanded) | Nhấn giữ Dynamic Island | Chạm vào island nổi | Chạm vào island |
| Minimal (nhiều activity) | Bong bóng tách rời | Bong bóng tách rời | Bong bóng tách rời |
| Lock screen | Màn hình khoá + banner | Thông báo dạng mở rộng | — |

## Live Activity và Dynamic Island

- **Live Activity** (iOS 16.1+) là nội dung "sống" của app: đơn giao hàng, cuộc gọi, đồng hồ, nhạc. Nó hiện ở **màn hình khoá** và trong **Dynamic Island**, kể cả khi app đã đóng.
- **Dynamic Island** chỉ là *một nơi hiển thị* Live Activity, trên iPhone 14 Pro trở lên. Phần UI này do hệ thống vẽ bằng **SwiftUI** trong một *Widget Extension*, chứ không phải bằng React Native. Khi app đang mở, iOS **ẩn** Live Activity của chính app khỏi island. Vì thế thư viện vẽ thêm một **island trong app** để trải nghiệm liền mạch.
- **Android không có Dynamic Island.** Thư viện mô phỏng nó bằng hai cách:
  1. **Notification "sống"** (luôn có): cập nhật liên tục, hiện ở màn hình khoá và thanh thông báo.
  2. **Island nổi** (tuỳ chọn): một viên thuốc màu đen bao quanh camera, nằm trên mọi app. Người dùng phải cấp quyền *Hiển thị trên ứng dụng khác*.

Thư viện không bắt bạn viết 3 lần (SwiftUI + Kotlin + React Native). Template JSX được chuyển thành một JSON nhỏ (xem [docs/SCHEMA.md](docs/SCHEMA.md)), rồi 3 bộ render native có sẵn vẽ JSON đó ra.

## Cài đặt (React Native CLI, kiến trúc mới, không cần Expo)

Yêu cầu: React Native ≥ 0.76, **New Architecture** bật, iOS ≥ 15.1 (Live Activity cần iOS 16.2, máy cũ hơn chỉ có island trong app), Android minSdk ≥ 24.
Thư viện là một **TurboModule** thuần, autolinking tự nhận, không phải sửa `AppDelegate` / `MainApplication`.

```sh
yarn add react-native-live-island          # hoặc "file:./vendor/react-native-live-island" / git URL
yarn add react-native-safe-area-context    # khuyên dùng (island trong app canh theo safe area)
cd ios && pod install
```

### iOS: Widget Extension (bắt buộc để có Live Activity)

Live Activity do một Widget Extension vẽ bằng SwiftUI. Script sau tự thêm extension vào project, cho **mọi build configuration**:

```sh
ruby node_modules/react-native-live-island/scripts/add-widget-target.rb ios/MyApp.xcodeproj
# --app-target MyApp   nếu project có nhiều app target
# --push               bật push token (cần thêm capability Push Notifications)
cd ios && pod install
```

Script làm những việc sau và chạy lại bao nhiêu lần cũng được:
- tạo target `DynamicIslandWidget` (iOS 16.2), compile thẳng 3 file Swift trong `node_modules/react-native-live-island/ios-widget`. Nâng thư viện là widget tự đi theo;
- bundle id = bundle id app của từng configuration + `.DynamicIslandWidget`, team và kiểu ký chép từ app;
- nhúng `.appex` vào app ("Embed Foundation Extensions");
- thêm `NSSupportsLiveActivities = YES` vào Info.plist của app.

Thích làm tay trong Xcode thì làm đúng các bước trên (File → New → Target → Widget Extension, xoá file mẫu, thêm 3 file trong `ios-widget/`).
`DynamicIslandAttributes.swift` ở `ios/` và `ios-widget/` phải **giống hệt nhau**, vì ActivityKit ghép hai phía theo tên kiểu.

> Xcode 26 + RN 0.81: nếu pod `fmt` báo lỗi `consteval`, compile riêng target `fmt` bằng C++17 trong `post_install` (xem `example/ios/Podfile`).

### Android

- Quyền `POST_NOTIFICATIONS` đã nằm trong manifest của thư viện. Gọi `requestNotificationPermission()` (Android 13+) trước khi start.
- **Island nổi** là tuỳ chọn. Thư viện **không** tự khai báo quyền overlay. Muốn bật thì app thêm `<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>`, gọi `configure({ androidOverlay: true })` và `requestOverlayPermission()`.
- **Foreground service** (chạy bộ, đạp xe, ghi âm…): xem mục [Android: foreground service](#android-foreground-service).

## Dùng

### 1. Bọc app một lần

```tsx
import { DynamicIslandProvider } from 'react-native-live-island';

export default function App() {
  return (
    <SafeAreaProvider>
      <DynamicIslandProvider>
        <RootNavigator />
      </DynamicIslandProvider>
    </SafeAreaProvider>
  );
}
```

### 2. Định nghĩa template, một lần cho mọi nền tảng

```tsx
import { defineLiveActivity, HStack, VStack, Text, Icon, Timer, Progress } from 'react-native-live-island';

type Data = { eta: Date; driver: string; step: number };

export const Delivery = defineLiveActivity<Data>({
  name: 'delivery',
  compact: {
    leading: () => <Icon name="bike" color="#34c759" />,
    trailing: (d) => <Timer to={d.eta} size={14} color="#34c759" width={44} />,
  },
  minimal: () => <Icon name="bike" color="#34c759" />,
  expanded: {
    leading: () => <Icon name="bike" size={26} color="#34c759" />,
    center: (d) => <Text weight="semibold">Tài xế {d.driver}</Text>,
    trailing: (d) => <Timer to={d.eta} size={22} weight="bold" />,
    bottom: (d) => <Progress value={d.step / 4} color="#34c759" />,
  },
  lockScreen: (d) => (
    <HStack>
      <Icon name="bike" size={22} />
      <VStack align="start" fill>
        <Text weight="semibold">Đang giao hàng</Text>
        <Text size={13} color="#8e8e93">Tài xế {d.driver}</Text>
      </VStack>
      <Timer to={d.eta} size={24} weight="bold" />
    </HStack>
  ),
  style: { background: '#101012', textColor: '#fff', keyline: '#34c759' },
  url: 'myapp://orders/123',
});
```

### 3. Điều khiển ở bất cứ đâu, với data khác nhau

```ts
const order = await Delivery.start({ eta: inMinutes(12), driver: 'Minh', step: 1 });
await order.patch({ step: 2 }, { alert: { title: 'Đơn hàng', body: 'Tài xế đã nhận món' } });
order.expand(3000);           // mở island trong app 3 giây
await order.end({ dismiss: 'immediate' });
```

Bạn cũng có thể dùng kiểu khai báo (declarative) với hook:

```tsx
useLiveActivity(Upload, { file, progress }, { active: uploading });
```

## Primitives

`VStack` · `HStack` · `ZStack` · `Text` · `Icon` · `Image` · `Spacer` · `Progress` · `Timer`

Mọi primitive nhận: `padding`, `background`, `radius`, `width`, `height`, `fill`, `opacity`.

- `Text`: `size`, `weight`, `color`, `lines`, `align`, `monospacedDigits`, `rounded`
- `Icon`: `name` là alias dùng chung (`play`, `pause`, `music`, `phone`, `car`, `bike`, `run`, `timer`, `upload`, `download`, `check`, `close`, `warning`, `bell`, `location`, `bolt`, `heart`, `star`, `bag`, `gift`, `flame`…) hoặc bất kỳ SF Symbol nào. Thêm `android="ic_x"` nếu muốn dùng drawable riêng.
- `Timer`: `to` (đếm ngược) hoặc `from` (đếm lên). **Hệ thống tự chạy giây**, không tốn update.
- `Progress`: `variant="bar" | "ring"`, `value` 0..1, hoặc `start`/`end` để hệ thống tự chạy.
- `Image`: `name` là ảnh trong Assets của **Widget Extension** (iOS) / drawable của app (Android).

Component tự viết vẫn dùng được nếu chỉ ghép từ các primitive và **không dùng hooks** (xem `Steps` trong `example/src/activities.tsx`).

## Tuỳ biến island trong app

```tsx
<DynamicIslandProvider
  theme={{ backgroundColor: '#000', expandedRadius: 40, spring: { damping: 15, stiffness: 200, mass: 1 }, backdropColor: null }}
  geometry={{ top: 12 }}      // ghi đè vị trí / kích thước nếu cần
  visibility="auto"            // 'always' = hiện cả khi Android đã có island nổi
  statusBar="hide"             // 'keep' = không ẩn status bar khi island hiện
  onPress={(entry, expanded) => { /* return true để chặn mở rộng mặc định */ }}
/>
```

Vị trí island được căn tự động:
- iPhone có Dynamic Island: trùng khít island phần cứng, nở ra từ camera.
- iPhone tai thỏ hoặc cũ hơn: island nằm ngay dưới status bar.
- Android edge-to-edge: island nằm trong status bar, bao quanh camera đục lỗ.

**Status bar:** iOS và Android luôn vẽ status bar (giờ, sóng, pin) đè lên app, nên chúng sẽ vẽ đè lên island trong app. Vì vậy khi island đang hiện một activity, thư viện tạm ẩn status bar. Muốn giữ status bar, dùng `statusBar="keep"`. Khi đó vùng status bar không nhận chạm, và dải cảm ứng bên dưới sẽ thay thế:

**Chạm vào island trong app (khi `statusBar="keep"`):** thư viện thêm một dải cảm ứng vô hình ngay dưới status bar (`theme.touchStripHeight`, mặc định 24). Bạn cũng có thể mở hoặc đóng island bằng code: `activity.expand(3000)` / `activity.collapse()`. Khi update kèm `alert`, island trong app tự mở rộng 4 giây, giống cách iOS làm (chỉnh bằng `configure({ alertExpandDuration })`).

Muốn xem thử một template mà không cần start activity: dùng `<LiveActivityPreview template={Delivery.template} data={...} />`.

## API khác

| Hàm | Ghi chú |
|---|---|
| `configure({ androidOverlay, push })` | Mặc định toàn cục |
| `areActivitiesEnabled()` | iOS: người dùng có bật Live Activities không. Android: notification có được bật không |
| `requestNotificationPermission()` | Android 13+ |
| `hasOverlayPermission()` / `requestOverlayPermission()` | Island nổi trên Android |
| `Template.attach(id, data)` | Gắn lại vào activity native còn chạy sau khi app bị kill và mở lại. Lấy `id` từ `getNativeActivities()` |
| `endAllActivities()` | Kết thúc tất cả, kể cả activity còn sót từ lần mở app trước |
| `addActivityStateListener` | `active` / `ended` / `dismissed` / `stale` |
| `addPushTokenListener` / `addPushToStartTokenListener` | Cập nhật hoặc khởi tạo Live Activity từ server qua APNs (xem docs/SCHEMA.md) |

## Android: foreground service

Với các việc phải chạy nền lâu như chạy bộ, đạp xe hay ghi âm, Android bắt buộc app có một foreground service, và service đó phải có notification riêng.
Thư viện tự làm việc này: notification của Live Activity **chính là** notification của service. Khi đó máy chỉ hiện **một** notification, và process cùng JS vẫn sống khi khoá màn hình.

```ts
const run = await Run.start(data, { androidForegroundService: 'location' });
await run.patch({ distanceKm: 1.2 });   // cập nhật đúng notification của service
await run.end({ dismiss: 'immediate' }); // tắt service, notification biến mất
```

App tự khai báo quyền cho loại service mình dùng, thư viện không khai báo thay:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<!-- 'location' cần thêm quyền vị trí đã được cấp lúc start: ACCESS_FINE_LOCATION / ACCESS_COARSE_LOCATION -->
```

- Loại service hỗ trợ: `location`, `dataSync`, `mediaPlayback`, `connectedDevice`, `health`, `shortService`. Mỗi lúc chỉ **một** activity giữ service. Các activity khác vẫn là notification thường.
- Phải start khi app đang ở foreground. Đây là giới hạn của Android 12+.
- Nếu không start được service (thiếu quyền, đang ở nền), thư viện tự lùi về notification thường và in cảnh báo, không crash.
- Người dùng vuốt app khỏi đa nhiệm hoặc process bị kill: service dừng, notification biến mất. Lần mở app sau, thư viện dọn các notification mồ côi còn sót.
- Trong lúc service chạy, thư viện giữ một headless JS task (`LiveIslandKeepAlive`, đã tự đăng ký), nên `setInterval`/`setTimeout` của JS vẫn chạy khi tắt màn hình. Bình thường React Native dừng timer khi app ở nền.
- Người dùng vuốt bỏ notification của service (Android 14+ cho phép): thư viện đăng lại.
- **Notification custom không bao giờ được làm chết app.** Nếu SystemUI không dựng được notification của một foreground service, Android giết app; với notification thường thì nó chỉ lặng lẽ bỏ đi. Vì vậy thư viện:
  - dựng thử RemoteViews ngay trong app trước mỗi lần đăng. Lần thử này chạy cùng code framework mà SystemUI dùng trên máy đó; lỗi thì dùng **notification chuẩn** (tiêu đề, nội dung, đồng hồ, thanh tiến độ, suy ra từ template);
  - nhớ máy nào từng chết khi đang đăng notification custom (ROM hãng). Từ đó notification foreground trên máy ấy dùng kiểu chuẩn cho tới khi app đổi version. JS đọc trạng thái bằng `getAndroidNotificationHealth()` → `{ customViews: 'allowed' | 'blocked', reason }`;
  - muốn luôn dùng kiểu chuẩn thì đặt `androidNotificationStyle: 'standard'` (trong `start()` hoặc `configure()`).
- Trên iOS tham số này bị bỏ qua. Để GPS chạy nền trên iOS, app cần `UIBackgroundModes` → `location`, như mọi app chạy bộ.

## Mẹo layout

- `fill` trên một stack nghĩa là "chiếm phần còn lại". Đừng đặt thêm `<Spacer />` cạnh nó, vì SwiftUI sẽ chia đôi chỗ trống và chữ bị xuống dòng.
- Giữ chữ trên một dòng bằng `lines={1}`, và cố định độ rộng cho `Timer` (`width`) để số không nhảy.

## Giới hạn cần biết

- **iOS**:
  - Payload tối đa 4 KB. Thư viện cảnh báo khi vượt.
  - Mỗi app chỉ chạy được tối đa ~5 Live Activity cùng lúc. Khi vượt, `start()` vẫn hiện island trong app và in cảnh báo.
  - Ảnh trong Live Activity phải nằm sẵn trong Assets của Widget Extension. Không tải được ảnh từ URL.
  - App ở nền không chạy JS được. Muốn cập nhật khi app đã bị đóng thì cần push từ server.
  - Live Activity tối đa 8 giờ.
- **Android**:
  - Island nổi cần quyền overlay do người dùng cấp. Google Play có review quyền này.
  - Status bar Android nằm trên cửa sổ overlay và giữ hết các chạm trong vùng của nó. Vì vậy island nổi có thêm một dải cảm ứng 24dp ngay dưới status bar.
  - Island nổi bám theo vị trí camera thật (giữa hoặc góc) và luôn được giữ trong màn hình.
  - Vì island nổi gắn với process của app, hệ thống có thể kill nó khi máy thiếu RAM. Notification vẫn còn.
  - Cảm biến/camera ở vị trí không chuẩn (lệch góc): dùng `geometry` để chỉnh.

## Cấu trúc

```
src/            API JS, serializer JSX→JSON, island trong app (React Native)
src/specs/      Spec TurboModule (codegen)
ios/            TurboModule iOS: LiveIsland.mm (ObjC++) + LiveIslandImpl.swift (ActivityKit, push token, icon)
ios-widget/     Widget Extension: renderer SwiftUI cho Live Activity + Dynamic Island
android/        TurboModule Android: notification, foreground service, island nổi, renderer View/RemoteViews
scripts/        add-widget-target.rb: thêm Widget Extension vào app bare
example/        App demo React Native 0.81.1 (giao hàng, nhạc, chạy bộ, upload)
```

Test: `npm test` (serializer/template/store) · `npm run typecheck`
