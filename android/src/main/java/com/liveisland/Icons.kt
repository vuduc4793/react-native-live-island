package com.liveisland

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffColorFilter
import android.graphics.RectF
import android.graphics.drawable.Drawable
import androidx.core.content.ContextCompat

/** Built-in icon aliases arrive as SF Symbol names (BUILTIN_ICONS in src/schema.ts). */
object Icons {
  private val builtin = mapOf(
    "play.fill" to R.drawable.di_ic_play,
    "pause.fill" to R.drawable.di_ic_pause,
    "stop.fill" to R.drawable.di_ic_stop,
    "forward.fill" to R.drawable.di_ic_forward,
    "backward.fill" to R.drawable.di_ic_backward,
    "music.note" to R.drawable.di_ic_music,
    "phone.fill" to R.drawable.di_ic_phone,
    "phone.down.fill" to R.drawable.di_ic_phone_down,
    "mic.fill" to R.drawable.di_ic_mic,
    "timer" to R.drawable.di_ic_timer,
    "clock.fill" to R.drawable.di_ic_clock,
    "arrow.down.circle.fill" to R.drawable.di_ic_download,
    "arrow.up.circle.fill" to R.drawable.di_ic_upload,
    "checkmark.circle.fill" to R.drawable.di_ic_check,
    "xmark.circle.fill" to R.drawable.di_ic_close,
    "exclamationmark.triangle.fill" to R.drawable.di_ic_warning,
    "bell.fill" to R.drawable.di_ic_bell,
    "car.fill" to R.drawable.di_ic_car,
    "bicycle" to R.drawable.di_ic_bike,
    "figure.run" to R.drawable.di_ic_run,
    "location.fill" to R.drawable.di_ic_location,
    "bolt.fill" to R.drawable.di_ic_bolt,
    "battery.75" to R.drawable.di_ic_battery,
    "heart.fill" to R.drawable.di_ic_heart,
    "star.fill" to R.drawable.di_ic_star,
    "bag.fill" to R.drawable.di_ic_bag,
    "gift.fill" to R.drawable.di_ic_gift,
    "flame.fill" to R.drawable.di_ic_flame,
    "sportscourt.fill" to R.drawable.di_ic_sport,
  )

  /** App drawable by name (res/drawable of the host app), 0 when missing. */
  @SuppressLint("DiscouragedApi")
  fun appDrawable(context: Context, name: String): Int {
    if (name.isEmpty()) return 0
    val res = context.resources
    return res.getIdentifier(name, "drawable", context.packageName).takeIf { it != 0 }
      ?: res.getIdentifier(name, "mipmap", context.packageName)
  }

  /** `android` override → built-in alias → app drawable named like the symbol (dots → underscores). */
  fun resolve(context: Context, name: String?, android: String?): Int {
    android?.let { appDrawable(context, it) }?.takeIf { it != 0 }?.let { return it }
    if (name == null) return 0
    builtin[name]?.let { return it }
    return appDrawable(context, name.replace('.', '_').replace('-', '_').lowercase())
  }

  fun drawable(context: Context, name: String?, android: String?): Drawable? {
    val id = resolve(context, name, android)
    return if (id == 0) null else ContextCompat.getDrawable(context, id)?.mutate()
  }

  /** Rasterize a (tinted) drawable — RemoteViews can't size or tint arbitrary vectors on old APIs. */
  fun bitmap(drawable: Drawable, widthPx: Int, heightPx: Int, tint: Int?, radiusPx: Float = 0f, fill: Boolean = false): Bitmap {
    val w = widthPx.coerceAtLeast(1)
    val h = heightPx.coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    if (radiusPx > 0f) {
      val clip = Path().apply { addRoundRect(RectF(0f, 0f, w.toFloat(), h.toFloat()), radiusPx, radiusPx, Path.Direction.CW) }
      canvas.clipPath(clip)
    }
    val iw = drawable.intrinsicWidth
    val ih = drawable.intrinsicHeight
    if (iw > 0 && ih > 0) {
      // fill = cover the box (center crop), otherwise fit inside it
      val scale = if (fill) maxOf(w / iw.toFloat(), h / ih.toFloat()) else minOf(w / iw.toFloat(), h / ih.toFloat())
      val dw = (iw * scale).toInt()
      val dh = (ih * scale).toInt()
      val left = (w - dw) / 2
      val top = (h - dh) / 2
      drawable.setBounds(left, top, left + dw, top + dh)
    } else {
      drawable.setBounds(0, 0, w, h)
    }
    if (tint != null) drawable.colorFilter = PorterDuffColorFilter(tint, PorterDuff.Mode.SRC_IN)
    drawable.draw(canvas)
    return bitmap
  }

  /** Transparent bitmap used as a fixed-size gap inside RemoteViews. */
  fun spacer(widthPx: Int, heightPx: Int): Bitmap =
    Bitmap.createBitmap(widthPx.coerceAtLeast(1), heightPx.coerceAtLeast(1), Bitmap.Config.ALPHA_8)

  /** Ring progress as a bitmap for RemoteViews. */
  fun ring(sizePx: Int, strokePx: Float, value: Float, color: Int, track: Int): Bitmap {
    val size = sizePx.coerceAtLeast(2)
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    RingView.paintRing(Canvas(bitmap), size.toFloat(), size.toFloat(), strokePx, value, color, track, Paint(Paint.ANTI_ALIAS_FLAG))
    return bitmap
  }
}
