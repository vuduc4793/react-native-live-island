package com.liveisland

import android.content.Context
import android.content.res.ColorStateList
import android.os.Build
import android.os.SystemClock
import android.text.SpannableString
import android.text.Spanned
import android.text.style.StyleSpan
import android.text.style.TypefaceSpan
import android.util.TypedValue
import android.view.Gravity
import android.widget.RemoteViews
import androidx.core.content.ContextCompat

/**
 * Wire node → RemoteViews for the notification. RemoteViews only allow a fixed set of view
 * methods, so this renderer is best-effort compared to [ViewRenderer]:
 *  - fixed sizes, margins and outline radius need API 31+
 *  - time-based progress is a snapshot (timers still tick via Chronometer)
 *  - icons, images and rings are rasterized to bitmaps so they get exact sizes on every API
 */
class RemoteViewsRenderer(private val context: Context, private val defaultTextColor: Int?) {
  private enum class Parent { HORIZONTAL, VERTICAL, FRAME }

  private val pkg = context.packageName
  private val id = R.id.di_node

  /** Root container (vertical, full width) holding a region. */
  fun root(node: WireNode?, background: Int?): RemoteViews {
    val root = RemoteViews(pkg, R.layout.di_rv_root)
    background?.let { styleCard(root, it) }
    node?.let { root.addView(id, render(it, Parent.VERTICAL)) }
    return root
  }

  /** Collapsed row from the compact regions: [leading] —spacer— [trailing]. */
  fun compactRow(leading: WireNode?, trailing: WireNode?, background: Int?): RemoteViews {
    val root = RemoteViews(pkg, R.layout.di_rv_root)
    background?.let { styleCard(root, it) }
    val row = RemoteViews(pkg, R.layout.di_rv_h_fw)
    leading?.let { row.addView(id, render(it, Parent.HORIZONTAL)) }
    row.addView(id, RemoteViews(pkg, R.layout.di_rv_sp_h))
    trailing?.let { row.addView(id, render(it, Parent.HORIZONTAL)) }
    root.addView(id, row)
    return root
  }

  /** A colored background becomes a padded card, matching the iOS lock screen padding. */
  private fun styleCard(root: RemoteViews, color: Int) {
    root.setInt(id, "setBackgroundColor", color)
    val pad = context.dp(12)
    root.setViewPadding(id, pad, pad, pad, pad)
    if (Build.VERSION.SDK_INT >= 31) {
      root.setViewOutlinePreferredRadius(id, 14f, TypedValue.COMPLEX_UNIT_DIP)
    }
  }

  private fun stretches(node: WireNode) = node.fill || (node.t == "pg" && node.str("k") != "ring")

  /** Pick the layout variant: wrap, full width (vertical/frame parent) or weight 1 (horizontal parent). */
  private fun variant(node: WireNode, parent: Parent, wrap: Int, fullWidth: Int, weighted: Int): Int = when {
    !stretches(node) || node.has("w") -> wrap
    parent == Parent.HORIZONTAL -> weighted
    else -> fullWidth
  }

  private fun render(node: WireNode, parent: Parent): RemoteViews {
    val views = when (node.t) {
      "v" -> stack(node, parent, vertical = true)
      "h" -> stack(node, parent, vertical = false)
      "z" -> zstack(node, parent)
      "tx" -> text(node, parent)
      "tm" -> timer(node, parent)
      "ic" -> icon(node)
      "im" -> image(node)
      "sp" -> RemoteViews(pkg, if (parent == Parent.VERTICAL) R.layout.di_rv_sp_v else R.layout.di_rv_sp_h)
      "pg" -> progress(node, parent)
      else -> RemoteViews(pkg, R.layout.di_rv_sp_h)
    }
    applyMods(views, node)
    return views
  }

  private fun gap(px: Int, vertical: Boolean): RemoteViews {
    val views = RemoteViews(pkg, R.layout.di_rv_im)
    views.setImageViewBitmap(id, if (vertical) Icons.spacer(1, px) else Icons.spacer(px, 1))
    return views
  }

  private fun stack(node: WireNode, parent: Parent, vertical: Boolean): RemoteViews {
    val layout = if (vertical) {
      variant(node, parent, R.layout.di_rv_v, R.layout.di_rv_v_fw, R.layout.di_rv_v_wt)
    } else {
      variant(node, parent, R.layout.di_rv_h, R.layout.di_rv_h_fw, R.layout.di_rv_h_wt)
    }
    val views = RemoteViews(pkg, layout)
    val a = node.str("a")
    views.setInt(id, "setGravity", if (vertical) hGravity(a) or Gravity.CENTER_VERTICAL else vGravity(a) or Gravity.CENTER_HORIZONTAL)
    val spacing = context.dp(node.dbl("sp") ?: 6.0)
    val childParent = if (vertical) Parent.VERTICAL else Parent.HORIZONTAL
    node.children.forEachIndexed { index, child ->
      if (index > 0 && spacing > 0) views.addView(id, gap(spacing, vertical))
      views.addView(id, render(child, childParent))
    }
    return views
  }

  private fun zstack(node: WireNode, parent: Parent): RemoteViews {
    val views = RemoteViews(pkg, variant(node, parent, R.layout.di_rv_z, R.layout.di_rv_z_fw, R.layout.di_rv_z_wt))
    val gravity = when (node.str("a")) {
      "s" -> Gravity.TOP or Gravity.START
      "e" -> Gravity.BOTTOM or Gravity.END
      else -> Gravity.CENTER
    }
    node.children.forEach { child ->
      val cell = RemoteViews(pkg, R.layout.di_rv_zcell)
      cell.setInt(id, "setGravity", gravity)
      cell.addView(id, render(child, Parent.VERTICAL))
      views.addView(id, cell)
    }
    return views
  }

  private fun styledText(node: WireNode): CharSequence {
    val raw = node.str("v") ?: ""
    val weight = weightOf(node.str("fw"))
    if (raw.isEmpty() || weight == 400) return raw
    val span = SpannableString(raw)
    when {
      weight >= 600 -> span.setSpan(StyleSpan(android.graphics.Typeface.BOLD), 0, raw.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      weight == 500 -> span.setSpan(TypefaceSpan("sans-serif-medium"), 0, raw.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      else -> span.setSpan(TypefaceSpan("sans-serif-light"), 0, raw.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    return span
  }

  // TextView.setGravity is only a RemoteViews method from API 31; calling it on older Android makes
  // SystemUI reject the notification ("Couldn't inflate contentViews"), which kills the app when it is
  // a foreground service notification. Alignment therefore comes from layout variants instead.
  private enum class Align { START, CENTER, END }

  private fun align(node: WireNode): Align {
    val horizontal = textGravity(node) and Gravity.HORIZONTAL_GRAVITY_MASK
    return when (horizontal) {
      Gravity.START, Gravity.LEFT -> Align.START
      Gravity.END, Gravity.RIGHT -> Align.END
      else -> Align.CENTER
    }
  }

  private fun textLayout(node: WireNode, parent: Parent): Int {
    val a = align(node)
    return variant(
      node,
      parent,
      wrap = when (a) { Align.START -> R.layout.di_rv_tx_s; Align.CENTER -> R.layout.di_rv_tx_c; Align.END -> R.layout.di_rv_tx_e },
      fullWidth = when (a) { Align.START -> R.layout.di_rv_tx_fw_s; Align.CENTER -> R.layout.di_rv_tx_fw_c; Align.END -> R.layout.di_rv_tx_fw_e },
      weighted = when (a) { Align.START -> R.layout.di_rv_tx_wt_s; Align.CENTER -> R.layout.di_rv_tx_wt_c; Align.END -> R.layout.di_rv_tx_wt_e },
    )
  }

  private fun timerLayout(node: WireNode, parent: Parent): Int {
    val a = align(node)
    return variant(
      node,
      parent,
      wrap = when (a) { Align.START -> R.layout.di_rv_tm_s; Align.CENTER -> R.layout.di_rv_tm_c; Align.END -> R.layout.di_rv_tm_e },
      fullWidth = when (a) { Align.START -> R.layout.di_rv_tm_fw_s; Align.CENTER -> R.layout.di_rv_tm_fw_c; Align.END -> R.layout.di_rv_tm_fw_e },
      weighted = when (a) { Align.START -> R.layout.di_rv_tm_wt_s; Align.CENTER -> R.layout.di_rv_tm_wt_c; Align.END -> R.layout.di_rv_tm_wt_e },
    )
  }

  private fun textStyle(views: RemoteViews, node: WireNode) {
    views.setTextViewTextSize(id, TypedValue.COMPLEX_UNIT_SP, node.float("fs") ?: 15f)
    (node.color("fc") ?: defaultTextColor)?.let { views.setTextColor(id, it) }
  }

  private fun text(node: WireNode, parent: Parent): RemoteViews {
    val views = RemoteViews(pkg, textLayout(node, parent))
    views.setTextViewText(id, styledText(node))
    textStyle(views, node)
    node.dbl("ln")?.toInt()?.let { views.setInt(id, "setMaxLines", it) }
    return views
  }

  private fun timer(node: WireNode, parent: Parent): RemoteViews {
    val views = RemoteViews(pkg, timerLayout(node, parent))
    val now = System.currentTimeMillis()
    val elapsed = SystemClock.elapsedRealtime()
    val end = node.dbl("e")
    val start = node.dbl("f")
    if (end != null) {
      views.setChronometer(id, elapsed + (end.toLong() - now), null, end > now)
      views.setChronometerCountDown(id, true)
    } else if (start != null) {
      views.setChronometer(id, elapsed - (now - start.toLong()), null, true)
    }
    textStyle(views, node)
    return views
  }

  private fun icon(node: WireNode): RemoteViews {
    val views = RemoteViews(pkg, R.layout.di_rv_im)
    val drawable = Icons.drawable(context, node.str("n"), node.str("an")) ?: return views
    val size = context.dp(node.dbl("s") ?: 16.0)
    val tint = node.color("fc") ?: defaultTextColor ?: 0xFF000000.toInt()
    views.setImageViewBitmap(id, Icons.bitmap(drawable, size, size, tint))
    return views
  }

  private fun image(node: WireNode): RemoteViews {
    val views = RemoteViews(pkg, R.layout.di_rv_im)
    val resId = Icons.appDrawable(context, node.str("n") ?: "")
    if (resId == 0) return views
    val w = node.dbl("w")
    val h = node.dbl("h")
    val drawable = ContextCompat.getDrawable(context, resId)?.mutate()
    if (drawable != null && w != null && h != null) {
      val radius = node.dbl("r")?.let { context.dpf(it) } ?: 0f
      views.setImageViewBitmap(id, Icons.bitmap(drawable, context.dp(w), context.dp(h), null, radius, fill = node.str("cm") != "fit"))
    } else {
      views.setImageViewResource(id, resId)
    }
    return views
  }

  private fun progress(node: WireNode, parent: Parent): RemoteViews {
    val color = node.color("fc") ?: defaultTextColor ?: 0xFF007AFF.toInt()
    val track = node.color("tc") ?: ((color and 0x00FFFFFF) or 0x40000000)
    val f = node.dbl("f")
    val e = node.dbl("e")
    val value = if (f != null && e != null) timedFraction(f, e) else node.float("v") ?: 0f

    if (node.str("k") == "ring") {
      val views = RemoteViews(pkg, R.layout.di_rv_im)
      val size = context.dp(node.dbl("s") ?: 20.0)
      views.setImageViewBitmap(id, Icons.ring(size, context.dpf(node.dbl("lw") ?: 3.0), value, color, track))
      return views
    }

    val views = RemoteViews(pkg, if (parent == Parent.HORIZONTAL && !node.has("w")) R.layout.di_rv_pg_wt else R.layout.di_rv_pg)
    views.setProgressBar(id, 1000, (value * 1000).toInt(), false)
    if (Build.VERSION.SDK_INT >= 31) {
      views.setColorStateList(id, "setProgressTintList", ColorStateList.valueOf(color))
      views.setColorStateList(id, "setProgressBackgroundTintList", ColorStateList.valueOf(track))
      node.dbl("lw")?.let { views.setViewLayoutHeight(id, it.toFloat(), TypedValue.COMPLEX_UNIT_DIP) }
    }
    return views
  }

  private fun applyMods(views: RemoteViews, node: WireNode) {
    node.padding?.let { p ->
      views.setViewPadding(id, context.dp(p[3]), context.dp(p[0]), context.dp(p[1]), context.dp(p[2]))
    }
    node.color("bg")?.let { views.setInt(id, "setBackgroundColor", it) }
    if (Build.VERSION.SDK_INT >= 31) {
      // View.setAlpha is not a RemoteViews method before API 31 either (see textLayout()).
      node.float("o")?.let { views.setFloat(id, "setAlpha", it) }
      node.float("r")?.let { views.setViewOutlinePreferredRadius(id, it, TypedValue.COMPLEX_UNIT_DIP) }
      if (node.t != "ic" && node.t != "im" && !(node.t == "pg" && node.str("k") == "ring")) {
        node.float("w")?.let { views.setViewLayoutWidth(id, it, TypedValue.COMPLEX_UNIT_DIP) }
        if (node.t != "pg") node.float("h")?.let { views.setViewLayoutHeight(id, it, TypedValue.COMPLEX_UNIT_DIP) }
      }
    }
  }
}
