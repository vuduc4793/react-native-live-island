// Keep in sync with ios-widget/DynamicIslandAttributes.swift — ActivityKit matches the app and the
// widget extension by this type, so both copies must stay identical.
import ActivityKit
import Foundation

@available(iOS 16.1, *)
struct DynamicIslandAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// JSON-encoded WirePayload (see src/schema.ts)
    var payload: String
  }

  /// Template name passed to defineLiveActivity
  var name: String
}
