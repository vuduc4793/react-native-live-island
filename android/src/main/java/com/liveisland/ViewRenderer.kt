package com.liveisland

import android.content.Context
import android.graphics.Outline
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

internal fun weightOf(fw: String?): Int = when (fw) {
  "ul" -> 200
  "l" -> 300
  "m" -> 500
  "sb" -> 600
  "b" -> 700
  "h" -> 800
  else -> 400
}

internal fun typefaceFor(fw: String?, rounded: Boolean): Typeface {
  val base = if (rounded) Typeface.create("sans-serif-rounded", Typeface.NORMAL) ?: Typeface.DEFAULT else Typeface.DEFAULT
  val weight = weightOf(fw)
  return if (Build.VERSION.SDK_INT >= 28) {
    Typeface.create(base, weight, false)
  } else {
    Typeface.create(base, if (weight >= 600) Typeface.BOLD else Typeface.NORMAL)
  }
}

/** Horizontal gravity for 's' / 'c' / 'e', center by default (SwiftUI semantics). */
internal fun hGravity(a: String?) = when (a) {
  "s" -> Gravity.START
  "e" -> Gravity.END
  else -> Gravity.CENTER_HORIZONTAL
}

internal fun vGravity(a: String?) = when (a) {
  "s" -> Gravity.TOP
  "e" -> Gravity.BOTTOM
  else -> Gravity.CENTER_VERTICAL
}

/** Text alignment: explicit `ta`, else leading when the text fills its row, else centered. */
internal fun textGravity(node: WireNode): Int = when (node.str("ta")) {
  "s" -> Gravity.START
  "e" -> Gravity.END
  "c" -> Gravity.CENTER_HORIZONTAL
  else -> if (node.fill) Gravity.START else Gravity.CENTER_HORIZONTAL
} or Gravity.CENTER_VERTICAL

/**
 * Wire node → real Android views. Used by the floating island overlay and anywhere a live
 * (ticking) rendering is needed.
 */
class ViewRenderer(private val context: Context, private val defaultTextColor: Int) {

  fun render(node: WireNode): View {
    val view = when (node.t) {
      "v", "h" -> stack(node)
      "z" -> zstack(node)
      "tx" -> text(node)
      "tm" -> timer(node)
      "ic" -> icon(node)
      "im" -> image(node)
      "sp" -> View(context).apply {
        val min = context.dp(node.dbl("s") ?: 0.0)
        minimumWidth = min
        minimumHeight = min
      }
      "pg" -> progress(node)
      else -> View(context)
    }
    applyMods(view, node)
    return view
  }

  private fun stack(node: WireNode): LinearLayout {
    val vertical = node.t == "v"
    val layout = LinearLayout(context)
    layout.orientation = if (vertical) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
    val a = node.str("a")
    layout.gravity = if (vertical) hGravity(a) or Gravity.CENTER_VERTICAL else vGravity(a) or Gravity.CENTER_HORIZONTAL
    val spacing = context.dp(node.dbl("sp") ?: 6.0)
    node.children.forEachIndexed { index, child ->
      val view = render(child)
      val params = linearParams(child, vertical)
      if (index > 0) {
        if (vertical) params.topMargin = spacing else params.marginStart = spacing
      }
      layout.addView(view, params)
    }
    return layout
  }

  private fun zstack(node: WireNode): FrameLayout {
    val frame = FrameLayout(context)
    val a = node.str("a")
    val gravity = when (a) {
      "s" -> Gravity.TOP or Gravity.START
      "e" -> Gravity.BOTTOM or Gravity.END
      else -> Gravity.CENTER
    }
    node.children.forEach { child ->
      val params = FrameLayout.LayoutParams(widthOf(child, ViewGroup.LayoutParams.WRAP_CONTENT), heightOf(child))
      if (child.fill || isBar(child)) params.width = ViewGroup.LayoutParams.MATCH_PARENT
      params.gravity = gravity
      frame.addView(render(child), params)
    }
    return frame
  }

  /** Icons and rings have an intrinsic square size (`s`). */
  private fun intrinsic(node: WireNode): Int? = when {
    node.t == "ic" -> context.dp(node.dbl("s") ?: 16.0)
    node.t == "pg" && node.str("k") == "ring" -> context.dp(node.dbl("s") ?: 20.0)
    else -> null
  }

  private fun isBar(node: WireNode) = node.t == "pg" && node.str("k") != "ring"

  private fun padH(node: WireNode) = node.padding?.let { context.dp(it[1] + it[3]) } ?: 0

  private fun padV(node: WireNode) = node.padding?.let { context.dp(it[0] + it[2]) } ?: 0

  private fun widthOf(node: WireNode, fallback: Int): Int =
    node.dbl("w")?.let { context.dp(it) } ?: intrinsic(node)?.plus(padH(node)) ?: fallback

  private fun heightOf(node: WireNode): Int = node.dbl("h")?.let { context.dp(it) } ?: intrinsic(node)?.plus(padV(node)) ?: when {
    isBar(node) -> context.dp(node.dbl("lw") ?: 4.0)
    else -> ViewGroup.LayoutParams.WRAP_CONTENT
  }

  /** Layout params for a top-level region placed in a horizontal (or vertical) container. */
  fun rootParams(node: WireNode, parentVertical: Boolean = false) = linearParams(node, parentVertical)

  /** Layout params of a child inside a LinearLayout, honoring fill / spacer / fixed size. */
  fun linearParams(child: WireNode, parentVertical: Boolean): LinearLayout.LayoutParams {
    val params = LinearLayout.LayoutParams(widthOf(child, ViewGroup.LayoutParams.WRAP_CONTENT), heightOf(child))
    when {
      child.t == "sp" -> {
        params.width = 0
        params.height = 0
        params.weight = 1f
      }
      (child.fill || isBar(child)) && child.dbl("w") == null -> {
        if (parentVertical) {
          params.width = ViewGroup.LayoutParams.MATCH_PARENT
        } else {
          params.width = 0
          params.weight = 1f
        }
      }
    }
    return params
  }

  private fun text(node: WireNode): TextView {
    val view = TextView(context)
    view.text = node.str("v") ?: ""
    styleText(view, node)
    node.dbl("ln")?.toInt()?.let {
      view.maxLines = it
      view.ellipsize = TextUtils.TruncateAt.END
    }
    return view
  }

  private fun styleText(view: TextView, node: WireNode) {
    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, node.float("fs") ?: 15f)
    view.setTextColor(node.color("fc") ?: defaultTextColor)
    view.typeface = typefaceFor(node.str("fw"), node.flag("rd"))
    view.gravity = textGravity(node)
    view.includeFontPadding = false
    if (node.flag("mo") || node.t == "tm") view.fontFeatureSettings = "tnum"
  }

  private fun timer(node: WireNode): TextView {
    val view = TimerTextView(context)
    view.end = node.dbl("e")
    view.start = node.dbl("f")
    styleText(view, node)
    view.maxLines = 1
    view.refresh()
    return view
  }

  private fun icon(node: WireNode): ImageView {
    val view = ImageView(context)
    view.setImageDrawable(Icons.drawable(context, node.str("n"), node.str("an")))
    view.setColorFilter(node.color("fc") ?: defaultTextColor)
    view.scaleType = ImageView.ScaleType.FIT_CENTER
    return view
  }

  private fun image(node: WireNode): ImageView {
    val view = ImageView(context)
    val id = Icons.appDrawable(context, node.str("n") ?: "")
    if (id != 0) view.setImageResource(id)
    view.scaleType = if (node.str("cm") == "fit") ImageView.ScaleType.FIT_CENTER else ImageView.ScaleType.CENTER_CROP
    return view
  }

  private fun progress(node: WireNode): View {
    val color = node.color("fc") ?: defaultTextColor
    val view: TickingProgressView = if (node.str("k") == "ring") {
      val ring = RingView(context)
      ring.stroke = context.dpf(node.dbl("lw") ?: 3.0)
      ring
    } else {
      BarView(context)
    }
    view.color = color
    view.track = node.color("tc") ?: ((color and 0x00FFFFFF) or 0x40000000)
    val f = node.dbl("f")
    val e = node.dbl("e")
    if (f != null && e != null) {
      view.timedStart = f
      view.timedEnd = e
      view.value = timedFraction(f, e)
    } else {
      view.value = node.float("v") ?: 0f
    }
    return view
  }

  private fun applyMods(view: View, node: WireNode) {
    node.padding?.let { p ->
      view.setPaddingRelative(context.dp(p[3]), context.dp(p[0]), context.dp(p[1]), context.dp(p[2]))
    }
    val radius = node.dbl("r")?.let { context.dpf(it) } ?: 0f
    node.color("bg")?.let { bg ->
      view.background = GradientDrawable().apply {
        setColor(bg)
        cornerRadius = radius
      }
    }
    if (radius > 0f) {
      view.outlineProvider = object : ViewOutlineProvider() {
        override fun getOutline(v: View, outline: Outline) {
          outline.setRoundRect(0, 0, v.width, v.height, radius)
        }
      }
      view.clipToOutline = true
    }
    node.float("o")?.let { view.alpha = it }
  }

}
