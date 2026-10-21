// SwiftUI renderer for the react-native-dynamic-island wire format (src/schema.ts).
// Compiled into the app's widget extension straight from the library (scripts/add-widget-target.rb). Do not edit; update the library.
import SwiftUI
import UIKit
import WidgetKit

// MARK: - Model

struct DIPayload: Decodable {
  struct Expanded: Decodable { let l: DINode?; let t: DINode?; let c: DINode?; let b: DINode? }
  struct Compact: Decodable { let l: DINode?; let t: DINode? }
  struct Style: Decodable { let bg: UInt32?; let kl: UInt32?; let fc: UInt32? }

  let ls: DINode?
  let ex: Expanded?
  let cp: Compact?
  let mn: DINode?
  let st: Style?
  let url: String?

  static func decode(_ json: String) -> DIPayload? {
    try? JSONDecoder().decode(DIPayload.self, from: Data(json.utf8))
  }
}

final class DINode: Decodable {
  let t: String
  let c: [DINode]?
  // shared modifiers
  let p: [Double]?
  let bg: UInt32?
  let r: Double?
  let w: Double?
  let h: Double?
  let fx: Int?
  let o: Double?
  // stacks
  let sp: Double?
  let a: String?
  // text / timer
  let v: DIValue?
  let fs: Double?
  let fw: String?
  let fc: UInt32?
  let ln: Int?
  let ta: String?
  let mo: Int?
  let rd: Int?
  // icon / image / spacer / progress
  let n: String?
  let s: Double?
  let cm: String?
  let k: String?
  let f: Double?
  let e: Double?
  let tc: UInt32?
  let lw: Double?
}

/// `v` is a string for text and a number for progress.
enum DIValue: Decodable {
  case string(String)
  case number(Double)

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if let d = try? container.decode(Double.self) {
      self = .number(d)
    } else {
      self = .string(try container.decode(String.self))
    }
  }

  var string: String {
    switch self {
    case .string(let s): return s
    case .number(let d): return d.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(d)) : String(d)
    }
  }

  var number: Double {
    switch self {
    case .string(let s): return Double(s) ?? 0
    case .number(let d): return d
    }
  }
}

// MARK: - Helpers

extension Color {
  init(argb: UInt32) {
    self.init(
      .sRGB,
      red: Double((argb >> 16) & 0xff) / 255,
      green: Double((argb >> 8) & 0xff) / 255,
      blue: Double(argb & 0xff) / 255,
      opacity: Double((argb >> 24) & 0xff) / 255
    )
  }
}

private func date(_ ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }

private func weight(_ w: String?) -> Font.Weight {
  switch w {
  case "ul": return .ultraLight
  case "l": return .light
  case "m": return .medium
  case "sb": return .semibold
  case "b": return .bold
  case "h": return .heavy
  default: return .regular
  }
}

private func hAlign(_ a: String?) -> HorizontalAlignment {
  switch a {
  case "s": return .leading
  case "e": return .trailing
  default: return .center
  }
}

private func vAlign(_ a: String?) -> VerticalAlignment {
  switch a {
  case "s": return .top
  case "e": return .bottom
  default: return .center
  }
}

private func textAlign(_ a: String?) -> TextAlignment {
  switch a {
  case "s": return .leading
  case "e": return .trailing
  default: return .center
  }
}

private func frameAlign(_ a: String?) -> Alignment {
  switch a {
  case "s": return .leading
  case "e": return .trailing
  default: return .center
  }
}

/// Default text color for a subtree (payload st.fc, else white).
private struct DITextColorKey: EnvironmentKey {
  static let defaultValue: Color = .white
}

extension EnvironmentValues {
  var diTextColor: Color {
    get { self[DITextColorKey.self] }
    set { self[DITextColorKey.self] = newValue }
  }
}

// MARK: - Views

struct DINodeView: View {
  let node: DINode
  @Environment(\.diTextColor) private var textColor

  var body: some View {
    content.modifier(DIModifiers(node: node))
  }

  private var children: [DINode] { node.c ?? [] }

  @ViewBuilder
  private var content: some View {
    switch node.t {
    case "v":
      VStack(alignment: hAlign(node.a), spacing: node.sp.map { CGFloat($0) }) {
        ForEach(children.indices, id: \.self) { DINodeView(node: children[$0]) }
      }
    case "h":
      HStack(alignment: vAlign(node.a), spacing: node.sp.map { CGFloat($0) }) {
        ForEach(children.indices, id: \.self) { DINodeView(node: children[$0]) }
      }
    case "z":
      ZStack(alignment: frameAlign(node.a)) {
        ForEach(children.indices, id: \.self) { DINodeView(node: children[$0]) }
      }
    case "tx":
      styled(Text(node.v?.string ?? ""))
        .lineLimit(node.ln)
    case "tm":
      timer
    case "ic":
      icon
    case "im":
      Image(node.n ?? "")
        .resizable()
        .aspectRatio(contentMode: node.cm == "fit" ? .fit : .fill)
    case "sp":
      Spacer(minLength: node.s.map { CGFloat($0) } ?? 0)
    case "pg":
      progress
    default:
      EmptyView()
    }
  }

  private func styled(_ text: Text) -> some View {
    let font = Font.system(
      size: CGFloat(node.fs ?? 15),
      weight: weight(node.fw),
      design: node.rd == 1 ? .rounded : .default
    )
    return text
      .font(node.mo == 1 || node.t == "tm" ? font.monospacedDigit() : font)
      .foregroundColor(node.fc.map { Color(argb: $0) } ?? textColor)
      .multilineTextAlignment(textAlign(node.ta))
  }

  @ViewBuilder
  private var timer: some View {
    if let end = node.e {
      // Countdown that the system keeps ticking without any app updates.
      let now = Date()
      let target = date(end)
      styled(Text(timerInterval: min(now, target)...target, countsDown: true))
    } else if let start = node.f {
      styled(Text(date(start), style: .timer))
    }
  }

  @ViewBuilder
  private var icon: some View {
    let name = node.n ?? ""
    let size = CGFloat(node.s ?? 16)
    let color = node.fc.map { Color(argb: $0) } ?? textColor
    if UIImage(systemName: name) != nil {
      Image(systemName: name)
        .font(.system(size: size, weight: .semibold))
        .foregroundColor(color)
    } else {
      Image(name)
        .resizable()
        .renderingMode(.template)
        .scaledToFit()
        .frame(width: size, height: size)
        .foregroundColor(color)
    }
  }

  @ViewBuilder
  private var progress: some View {
    let tint = node.fc.map { Color(argb: $0) } ?? textColor
    let track = node.tc.map { Color(argb: $0) } ?? tint.opacity(0.25)
    let lineWidth = CGFloat(node.lw ?? (node.k == "ring" ? 3 : 4))

    if node.k == "ring" {
      let size = CGFloat(node.s ?? 20)
      if let f = node.f, let e = node.e, e > f {
        // System-driven timer progress; circular style is drawn by the system.
        ProgressView(timerInterval: date(f)...date(e), countsDown: false) {
          EmptyView()
        } currentValueLabel: {
          EmptyView()
        }
        .progressViewStyle(.circular)
        .tint(tint)
        .frame(width: size, height: size)
      } else {
        ZStack {
          Circle().stroke(track, lineWidth: lineWidth)
          Circle()
            .trim(from: 0, to: CGFloat(node.v?.number ?? 0))
            .stroke(tint, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
            .rotationEffect(.degrees(-90))
        }
        .frame(width: size - lineWidth, height: size - lineWidth)
        .padding(lineWidth / 2)
      }
    } else if let f = node.f, let e = node.e, e > f {
      ProgressView(timerInterval: date(f)...date(e), countsDown: false) {
        EmptyView()
      } currentValueLabel: {
        EmptyView()
      }
      .progressViewStyle(.linear)
      .tint(tint)
    } else {
      GeometryReader { geo in
        ZStack(alignment: .leading) {
          Capsule().fill(track)
          Capsule().fill(tint).frame(width: geo.size.width * CGFloat(node.v?.number ?? 0))
        }
      }
      .frame(height: lineWidth)
    }
  }
}

struct DIModifiers: ViewModifier {
  let node: DINode

  func body(content: Content) -> some View {
    let p = node.p ?? []
    let padded = content.padding(
      EdgeInsets(
        top: CGFloat(p.count == 4 ? p[0] : 0),
        leading: CGFloat(p.count == 4 ? p[3] : 0),
        bottom: CGFloat(p.count == 4 ? p[2] : 0),
        trailing: CGFloat(p.count == 4 ? p[1] : 0)
      )
    )
    let sized = padded
      .frame(width: node.w.map { CGFloat($0) }, height: node.h.map { CGFloat($0) })
      .frame(maxWidth: node.fx == 1 ? .infinity : nil, alignment: frameAlign(node.ta ?? "s"))
    let radius = CGFloat(node.r ?? 0)
    return sized
      .background(node.bg.map { Color(argb: $0) } ?? Color.clear)
      .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
      .opacity(node.o ?? 1)
  }
}

/// Renders an optional region; empty regions collapse to nothing.
struct DIRegion: View {
  let node: DINode?

  var body: some View {
    if let node {
      DINodeView(node: node)
    }
  }
}
