package com.liveisland

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import android.widget.TextView
import kotlin.math.max
import kotlin.math.min

private const val TICK_MS = 250L

/** Fraction of a time-based progress (f..e epoch ms) at `now`. */
internal fun timedFraction(start: Double, end: Double, now: Long = System.currentTimeMillis()): Float {
  if (end <= start) return 1f
  return ((now - start) / (end - start)).toFloat().coerceIn(0f, 1f)
}

/** Formats like SwiftUI's timer text: m:ss, or h:mm:ss past an hour. */
internal fun formatTimer(totalMs: Long): String {
  val total = max(0L, totalMs / 1000)
  val h = total / 3600
  val m = (total % 3600) / 60
  val s = total % 60
  return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

/** Base for views that redraw themselves on a clock while attached. */
abstract class TickingProgressView(context: Context) : View(context) {
  var value = 0f
    set(v) {
      field = v.coerceIn(0f, 1f)
      invalidate()
    }
  var color = 0xFFFFFFFF.toInt()
  var track = 0x40FFFFFF
  var stroke = 0f
  var timedStart: Double? = null
  var timedEnd: Double? = null

  protected val paint = Paint(Paint.ANTI_ALIAS_FLAG)

  private val tick = object : Runnable {
    override fun run() {
      val s = timedStart
      val e = timedEnd
      if (s != null && e != null) {
        value = timedFraction(s, e)
        if (value < 1f) postDelayed(this, TICK_MS)
      }
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    removeCallbacks(tick)
    tick.run()
  }

  override fun onDetachedFromWindow() {
    removeCallbacks(tick)
    super.onDetachedFromWindow()
  }
}

class RingView(context: Context) : TickingProgressView(context) {
  override fun onDraw(canvas: Canvas) {
    paintRing(canvas, width.toFloat(), height.toFloat(), stroke, value, color, track, paint)
  }

  companion object {
    fun paintRing(canvas: Canvas, w: Float, h: Float, stroke: Float, value: Float, color: Int, track: Int, paint: Paint) {
      val inset = stroke / 2f
      val size = min(w, h)
      val left = (w - size) / 2f + inset
      val top = (h - size) / 2f + inset
      val rect = RectF(left, top, left + size - stroke, top + size - stroke)
      paint.style = Paint.Style.STROKE
      paint.strokeWidth = stroke
      paint.strokeCap = Paint.Cap.ROUND
      paint.color = track
      canvas.drawArc(rect, 0f, 360f, false, paint)
      if (value > 0f) {
        paint.color = color
        canvas.drawArc(rect, -90f, 360f * value, false, paint)
      }
    }
  }
}

class BarView(context: Context) : TickingProgressView(context) {
  private val rect = RectF()

  override fun onDraw(canvas: Canvas) {
    val r = height / 2f
    paint.style = Paint.Style.FILL
    paint.color = track
    rect.set(0f, 0f, width.toFloat(), height.toFloat())
    canvas.drawRoundRect(rect, r, r, paint)
    if (value > 0f) {
      paint.color = color
      rect.set(0f, 0f, max(height.toFloat(), width * value), height.toFloat())
      canvas.drawRoundRect(rect, r, r, paint)
    }
  }
}

/** Countdown to `end` or count-up from `start`, refreshed while attached. */
@SuppressLint("AppCompatCustomView")
class TimerTextView(context: Context) : TextView(context) {
  var end: Double? = null
  var start: Double? = null

  private val tick = object : Runnable {
    override fun run() {
      val now = System.currentTimeMillis()
      val e = end
      val s = start
      text = when {
        e != null -> formatTimer((e - now).toLong() + 999) // round up like SwiftUI countdowns
        s != null -> formatTimer((now - s).toLong())
        else -> ""
      }
      if (e == null || e > now) postDelayed(this, TICK_MS)
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    removeCallbacks(tick)
    tick.run()
  }

  override fun onDetachedFromWindow() {
    removeCallbacks(tick)
    super.onDetachedFromWindow()
  }

  /** Render the current value immediately (before attach) so measuring gets the right width. */
  fun refresh() {
    tick.run()
    removeCallbacks(tick)
  }
}
