import ActivityKit
import Foundation
import UIKit

/// Swift side of the "LiveIsland" TurboModule (ios/LiveIsland.mm forwards every call here).
/// Contract: src/specs/NativeLiveIsland.ts. Payloads are JSON strings of `WirePayload`.
@objc(LiveIslandImpl)
public final class LiveIslandImpl: NSObject {
  public typealias Resolve = (Any?) -> Void
  public typealias Reject = (String, String, Error?) -> Void

  /// Set by LiveIsland.mm: (event name, body). Only called after JS can receive events.
  @objc public var emit: ((String, [String: Any]) -> Void)?

  private let lock = NSLock()
  private var observed = Set<String>()
  private var observing = false

  private var pushEnabled: Bool {
    Bundle.main.object(forInfoDictionaryKey: "LiveIsland_EnablePush") as? Bool ?? false
  }

  // MARK: - Events

  /// Called once the JS event emitter is wired: follow existing activities (and push-to-start tokens).
  @objc public func startObserving() {
    lock.lock()
    let first = !observing
    observing = true
    lock.unlock()
    guard first, #available(iOS 16.2, *) else { return }
    for activity in Activity<DynamicIslandAttributes>.activities {
      observe(activity)
    }
    if pushEnabled, #available(iOS 17.2, *) {
      Task { [weak self] in
        for await token in Activity<DynamicIslandAttributes>.pushToStartTokenUpdates {
          self?.send("onPushToStartToken", ["token": Self.hex(token)])
        }
      }
    }
  }

  private func send(_ event: String, _ body: [String: Any]) {
    lock.lock()
    let ready = observing
    lock.unlock()
    if ready { emit?(event, body) }
  }

  @available(iOS 16.2, *)
  private func observe(_ activity: Activity<DynamicIslandAttributes>) {
    lock.lock()
    let isNew = observed.insert(activity.id).inserted
    lock.unlock()
    guard isNew else { return }
    let id = activity.id
    let name = activity.attributes.name

    Task { [weak self] in
      for await state in activity.activityStateUpdates {
        self?.send("onActivityStateChange", ["id": id, "name": name, "state": Self.stateName(state)])
      }
    }
    if pushEnabled {
      Task { [weak self] in
        for await token in activity.pushTokenUpdates {
          self?.send("onPushToken", ["id": id, "name": name, "token": Self.hex(token)])
        }
      }
    }
  }

  // MARK: - Activities

  @objc public func areActivitiesEnabled() -> Bool {
    guard #available(iOS 16.2, *) else { return false }
    return ActivityAuthorizationInfo().areActivitiesEnabled
  }

  @objc public func startActivity(
    _ name: String,
    payload: String,
    options: [String: Any],
    resolve: @escaping Resolve,
    reject: @escaping Reject
  ) {
    guard #available(iOS 16.2, *) else { return Self.unsupported(reject) }
    do {
      let activity = try Activity.request(
        attributes: DynamicIslandAttributes(name: name),
        content: Self.content(payload, options),
        pushType: (options["push"] as? Bool ?? false) ? .token : nil
      )
      observe(activity)
      resolve(["id": activity.id, "overlay": false])
    } catch {
      reject("E_START", error.localizedDescription, error)
    }
  }

  @objc public func updateActivity(
    _ id: String,
    payload: String,
    options: [String: Any],
    resolve: @escaping Resolve,
    reject: @escaping Reject
  ) {
    guard #available(iOS 16.2, *) else { return Self.unsupported(reject) }
    guard let activity = Self.find(id) else {
      return reject("E_NOT_FOUND", "No Live Activity with id '\(id)'", nil)
    }
    let content = Self.content(payload, options)
    let alert = options["alert"] as? [String: Any]
    Task {
      if let alert {
        let config = AlertConfiguration(
          title: LocalizedStringResource(stringLiteral: alert["title"] as? String ?? ""),
          body: LocalizedStringResource(stringLiteral: alert["body"] as? String ?? ""),
          sound: .default
        )
        await activity.update(content, alertConfiguration: config)
      } else {
        await activity.update(content)
      }
      resolve(nil)
    }
  }

  @objc public func endActivity(
    _ id: String,
    payload: String?,
    options: [String: Any],
    resolve: @escaping Resolve,
    reject: @escaping Reject
  ) {
    guard #available(iOS 16.2, *) else { return Self.unsupported(reject) }
    guard let activity = Self.find(id) else { return resolve(nil) }
    let content = payload.map {
      ActivityContent(state: DynamicIslandAttributes.ContentState(payload: $0), staleDate: nil)
    }
    let policy = Self.dismissalPolicy(options)
    Task {
      await activity.end(content, dismissalPolicy: policy)
      resolve(nil)
    }
  }

  @objc public func endAllActivities(_ resolve: @escaping Resolve, reject: @escaping Reject) {
    guard #available(iOS 16.2, *) else { return resolve(nil) }
    Task {
      for activity in Activity<DynamicIslandAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      resolve(nil)
    }
  }

  @objc public func getActivities() -> [[String: Any]] {
    guard #available(iOS 16.2, *) else { return [] }
    return Activity<DynamicIslandAttributes>.activities.map {
      ["id": $0.id, "name": $0.attributes.name, "state": Self.stateName($0.activityState)]
    }
  }

  // MARK: - In-app icons

  /// SF Symbol (or app asset) tinted and aspect-fitted into a (size × 1.25)² box, as a PNG data URI.
  /// Same look as the widget's Image(systemName:) at that font size.
  @objc public func iconImage(_ name: String, size: Double, color: Double) -> String? {
    let config = UIImage.SymbolConfiguration(pointSize: CGFloat(size), weight: .semibold)
    guard let base = UIImage(systemName: name, withConfiguration: config) ?? UIImage(named: name) else { return nil }
    let argb = UInt32(truncatingIfNeeded: Int64(color))
    let tint = UIColor(
      red: CGFloat((argb >> 16) & 0xff) / 255,
      green: CGFloat((argb >> 8) & 0xff) / 255,
      blue: CGFloat(argb & 0xff) / 255,
      alpha: CGFloat((argb >> 24) & 0xff) / 255
    )
    let box = CGFloat(size) * 1.25
    let scale = min(box / base.size.width, box / base.size.height)
    let drawn = CGSize(width: base.size.width * scale, height: base.size.height * scale)
    let rect = CGRect(x: (box - drawn.width) / 2, y: (box - drawn.height) / 2, width: drawn.width, height: drawn.height)
    let image = UIGraphicsImageRenderer(size: CGSize(width: box, height: box)).image { _ in
      base.withTintColor(tint, renderingMode: .alwaysOriginal).draw(in: rect)
    }
    guard let png = image.pngData() else { return nil }
    return "data:image/png;base64," + png.base64EncodedString()
  }

  // MARK: - Helpers

  private static func unsupported(_ reject: Reject) {
    reject("E_UNSUPPORTED", "Live Activities require iOS 16.2 or newer", nil)
  }

  private static func date(_ value: Any?) -> Date? {
    (value as? NSNumber).map { Date(timeIntervalSince1970: $0.doubleValue / 1000) }
  }

  private static func hex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
  }

  @available(iOS 16.2, *)
  private static func content(_ payload: String, _ options: [String: Any]) -> ActivityContent<DynamicIslandAttributes.ContentState> {
    ActivityContent(
      state: DynamicIslandAttributes.ContentState(payload: payload),
      staleDate: date(options["staleDate"]),
      relevanceScore: (options["relevanceScore"] as? NSNumber)?.doubleValue ?? 0
    )
  }

  @available(iOS 16.2, *)
  private static func find(_ id: String) -> Activity<DynamicIslandAttributes>? {
    Activity<DynamicIslandAttributes>.activities.first { $0.id == id }
  }

  @available(iOS 16.2, *)
  private static func dismissalPolicy(_ options: [String: Any]) -> ActivityUIDismissalPolicy {
    switch options["dismissal"] as? String {
    case "immediate": return .immediate
    case "after": return date(options["dismissAt"]).map { .after($0) } ?? .default
    default: return .default
    }
  }

  @available(iOS 16.1, *)
  private static func stateName(_ state: ActivityState) -> String {
    switch state {
    case .active: return "active"
    case .ended: return "ended"
    case .dismissed: return "dismissed"
    case .stale: return "stale"
    case .pending: return "pending"
    @unknown default: return "active"
    }
  }
}
