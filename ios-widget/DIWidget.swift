// Live Activity + Dynamic Island configuration for every template defined with defineLiveActivity().
// Compiled into the app's widget extension straight from the library (scripts/add-widget-target.rb). Do not edit; update the library.
import ActivityKit
import SwiftUI
import WidgetKit

struct DynamicIslandLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: DynamicIslandAttributes.self) { context in
      let payload = DIPayload.decode(context.state.payload)
      let background = payload?.st?.bg.map { Color(argb: $0) }
      DIRegion(node: payload?.ls)
        .environment(\.diTextColor, payload?.st?.fc.map { Color(argb: $0) } ?? .primary)
        .padding(16)
        .frame(maxWidth: .infinity)
        .activityBackgroundTint(background)
        .activitySystemActionForegroundColor(payload?.st?.fc.map { Color(argb: $0) } ?? .primary)
        .widgetURL(payload?.url.flatMap(URL.init(string:)))
    } dynamicIsland: { context in
      let payload = DIPayload.decode(context.state.payload)
      let textColor = payload?.st?.fc.map { Color(argb: $0) } ?? .white

      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          DIRegion(node: payload?.ex?.l).environment(\.diTextColor, textColor)
        }
        DynamicIslandExpandedRegion(.trailing) {
          DIRegion(node: payload?.ex?.t).environment(\.diTextColor, textColor)
        }
        DynamicIslandExpandedRegion(.center) {
          DIRegion(node: payload?.ex?.c).environment(\.diTextColor, textColor)
        }
        DynamicIslandExpandedRegion(.bottom) {
          DIRegion(node: payload?.ex?.b).environment(\.diTextColor, textColor)
        }
      } compactLeading: {
        DIRegion(node: payload?.cp?.l).environment(\.diTextColor, textColor)
      } compactTrailing: {
        DIRegion(node: payload?.cp?.t).environment(\.diTextColor, textColor)
      } minimal: {
        DIRegion(node: payload?.mn ?? payload?.cp?.l).environment(\.diTextColor, textColor)
      }
      .widgetURL(payload?.url.flatMap(URL.init(string:)))
      .keylineTint(payload?.st?.kl.map { Color(argb: $0) })
    }
  }
}

@main
struct DynamicIslandWidgetBundle: WidgetBundle {
  var body: some Widget {
    DynamicIslandLiveActivity()
  }
}
