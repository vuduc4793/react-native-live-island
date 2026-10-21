package com.liveisland

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.provider.Settings
import android.transition.ChangeBounds
import android.transition.Fade
import android.transition.TransitionManager
import android.transition.TransitionSet
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import kotlin.math.abs
import kotlin.math.max

/**
 * Floating Dynamic Island look-alike drawn over other apps (TYPE_APPLICATION_OVERLAY),
 * centered on the front camera cutout.
 *
 * Layout of the window content (horizontal, centered): [placeholder][pill][bubble].
 * The invisible placeholder mirrors the bubble so the pill stays centered on the camera.
 */
@SuppressLint("StaticFieldLeak") // holds the application context only
object IslandOverlay {
  private const val ANIM_MS = 420L
  private const val TOUCH_STRIP_DP = 24
  private const val ISLAND_COLOR = 0xFF000000.toInt()

  private var context: Context? = null
  private var windowManager: WindowManager? = null
  private var params: WindowManager.LayoutParams? = null
  private var root: LinearLayout? = null
  private var placeholder: View? = null
  private var pill: FrameLayout? = null
  private var bubble: FrameLayout? = null
  private var pillBackground: GradientDrawable? = null

  private var expanded = false
  private var frontId: String? = null
  private var bubbleId: String? = null

  fun canDraw(context: Context) = Build.VERSION.SDK_INT >= 26 && Settings.canDrawOverlays(context)

  private fun overlayEntries() = ActivityRegistry.all().filter { it.overlayRequested && it.state == "active" }

  /** Whether `id` is currently drawn by the overlay. */
  fun isShowing(id: String) = root != null && (frontId == id || bubbleId == id || overlayEntries().any { it.id == id })

  // region geometry

  private class Geometry(
    val screenWidth: Int,
    val centerX: Int,
    val centerY: Int,
    val cameraWidth: Int,
    val compactHeight: Int,
    val statusBar: Int,
  )

  @Suppress("DEPRECATION")
  private fun geometry(ctx: Context, wm: WindowManager): Geometry {
    var screenWidth = ctx.resources.displayMetrics.widthPixels
    var cutout: Rect? = null
    if (Build.VERSION.SDK_INT >= 30) {
      val metrics = wm.currentWindowMetrics
      screenWidth = metrics.bounds.width()
      cutout = metrics.windowInsets.displayCutout?.boundingRectTop?.takeIf { !it.isEmpty }
    }
    val statusBarId = ctx.resources.getIdentifier("status_bar_height", "dimen", "android")
    val statusBar = if (statusBarId != 0) ctx.resources.getDimensionPixelSize(statusBarId) else ctx.dp(24)

    val minHeight = ctx.dp(32)
    return if (cutout != null) {
      Geometry(
        screenWidth = screenWidth,
        centerX = cutout.centerX(),
        centerY = cutout.centerY(),
        cameraWidth = cutout.width(),
        compactHeight = max(cutout.height(), minHeight) + ctx.dp(4),
        statusBar = statusBar,
      )
    } else {
      Geometry(
        screenWidth = screenWidth,
        centerX = screenWidth / 2,
        centerY = max(statusBar / 2, minHeight / 2 + ctx.dp(4)),
        cameraWidth = ctx.dp(24),
        compactHeight = minHeight + ctx.dp(4),
        statusBar = statusBar,
      )
    }
  }

  // endregion

  /** Re-render the island from the registry. Call on the main thread after any change. */
  fun refresh(ctx: Context, animate: Boolean = true) {
    val app = ctx.applicationContext
    val entries = overlayEntries()
    if (entries.isEmpty() || !canDraw(app)) {
      hide()
      return
    }
    val front = entries.last()
    val second = entries.getOrNull(entries.size - 2)
    if (front.id != frontId) expanded = false
    if (!front.payload.hasExpanded) expanded = false

    val wm = windowManager ?: (app.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
    val geo = geometry(app, wm)
    val firstShow = root == null
    if (firstShow) attach(app, wm, geo)
    val root = root ?: return
    val pill = pill ?: return

    if (animate && !firstShow) {
      val previousWidth = root.width
      val previousHeight = root.height
      // Keep the window big enough while the pill shrinks, then let it wrap again.
      root.minimumWidth = previousWidth
      root.minimumHeight = previousHeight
      root.postDelayed({
        root.minimumWidth = 0
        root.minimumHeight = 0
        root.requestLayout()
      }, ANIM_MS)
      val transition = TransitionSet()
        .addTransition(ChangeBounds().setInterpolator(OvershootInterpolator(0.8f)))
        .addTransition(Fade())
        .setDuration(ANIM_MS)
      TransitionManager.beginDelayedTransition(root, transition)
    }

    frontId = front.id
    bubbleId = second?.id
    val textColor = front.payload.textColor ?: 0xFFFFFFFF.toInt()
    val renderer = ViewRenderer(app, textColor)

    pill.removeAllViews()
    val pillParams = pill.layoutParams as LinearLayout.LayoutParams
    val targetRadius: Float
    if (expanded) {
      pillParams.width = geo.screenWidth - app.dp(24)
      pillParams.height = ViewGroup.LayoutParams.WRAP_CONTENT
      pill.minimumHeight = app.dp(84)
      pill.addView(expandedContent(app, renderer, front.payload, geo), FrameLayout.LayoutParams(-1, -2))
      targetRadius = app.dpf(36.0)
    } else {
      pillParams.width = ViewGroup.LayoutParams.WRAP_CONTENT
      pillParams.height = geo.compactHeight
      pill.minimumHeight = 0
      pill.addView(compactContent(app, renderer, front.payload, geo), FrameLayout.LayoutParams(-2, -1))
      targetRadius = geo.compactHeight / 2f
    }
    pill.layoutParams = pillParams
    animateRadius(targetRadius, animate && !firstShow)

    // The status bar sits above overlay windows and swallows touches, so a compact pill inside
    // it can't be tapped. Extend the window with an invisible strip just below the status bar.
    val pillBottom = (params?.y ?: 0) + geo.compactHeight
    val strip = if (expanded) 0 else max(0, geo.statusBar - pillBottom) + app.dp(TOUCH_STRIP_DP)
    root.setPadding(0, 0, 0, strip)

    // Detached minimal bubble for the second activity (hidden while expanded, like iOS).
    val bubble = bubble!!
    val placeholder = placeholder!!
    bubble.removeAllViews()
    val showBubble = second != null && !expanded
    if (showBubble) {
      val size = geo.compactHeight
      val bubbleRenderer = ViewRenderer(app, second!!.payload.textColor ?: 0xFFFFFFFF.toInt())
      val node = second.payload.mn ?: second.payload.cpLeading
      node?.let { bubble.addView(bubbleRenderer.render(it), FrameLayout.LayoutParams(-2, -2, Gravity.CENTER)) }
      (bubble.layoutParams as LinearLayout.LayoutParams).apply {
        width = size
        height = size
      }
      (placeholder.layoutParams as LinearLayout.LayoutParams).apply {
        width = size
        height = size
      }
      bubble.visibility = View.VISIBLE
      placeholder.visibility = View.INVISIBLE
    } else {
      bubble.visibility = View.GONE
      placeholder.visibility = View.GONE
    }
    root.requestLayout()
  }

  private fun compactContent(ctx: Context, renderer: ViewRenderer, payload: WirePayload, geo: Geometry): View {
    val leading = payload.cpLeading
    val trailing = payload.cpTrailing
    // Keep the camera hole clear between leading and trailing.
    val gap = if (leading == null && trailing == null) geo.cameraWidth + ctx.dp(16) else geo.cameraWidth + ctx.dp(8)
    val row = CompactRow(ctx, gap)
    val pad = ctx.dp(12)
    row.setPadding(pad, 0, pad, 0)
    leading?.let { row.leading.addView(renderer.render(it), FrameLayout.LayoutParams(-2, -2, Gravity.START or Gravity.CENTER_VERTICAL)) }
    trailing?.let { row.trailing.addView(renderer.render(it), FrameLayout.LayoutParams(-2, -2, Gravity.END or Gravity.CENTER_VERTICAL)) }
    return row
  }

  /**
   * [leading slot][camera gap][trailing slot] where both slots share the width of the wider one,
   * so the gap always stays centered on the camera whatever the content widths are.
   */
  private class CompactRow(ctx: Context, private val gap: Int) : ViewGroup(ctx) {
    val leading = FrameLayout(ctx)
    val trailing = FrameLayout(ctx)

    init {
      addView(leading)
      addView(trailing)
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
      val height = MeasureSpec.getSize(heightMeasureSpec)
      val childHeight = MeasureSpec.makeMeasureSpec(height, MeasureSpec.AT_MOST)
      val wrap = MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED)
      leading.measure(wrap, childHeight)
      trailing.measure(wrap, childHeight)
      val side = max(leading.measuredWidth, trailing.measuredWidth)
      val exact = MeasureSpec.makeMeasureSpec(side, MeasureSpec.EXACTLY)
      leading.measure(exact, childHeight)
      trailing.measure(exact, childHeight)
      val width = paddingLeft + side + gap + side + paddingRight
      val measuredHeight = if (MeasureSpec.getMode(heightMeasureSpec) == MeasureSpec.UNSPECIFIED) {
        max(leading.measuredHeight, trailing.measuredHeight)
      } else {
        height
      }
      setMeasuredDimension(width, measuredHeight)
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
      val h = b - t
      val lh = leading.measuredHeight
      val th = trailing.measuredHeight
      val left = paddingLeft
      leading.layout(left, (h - lh) / 2, left + leading.measuredWidth, (h - lh) / 2 + lh)
      val tl = left + leading.measuredWidth + gap
      trailing.layout(tl, (h - th) / 2, tl + trailing.measuredWidth, (h - th) / 2 + th)
    }
  }

  private fun expandedContent(ctx: Context, renderer: ViewRenderer, payload: WirePayload, geo: Geometry): View {
    val column = LinearLayout(ctx)
    column.orientation = LinearLayout.VERTICAL
    val pad = ctx.dp(16)
    // extra top space so the first row clears the camera
    column.setPadding(pad, max(pad, geo.compactHeight / 2 + ctx.dp(6)), pad, pad)

    val row = LinearLayout(ctx)
    row.orientation = LinearLayout.HORIZONTAL
    row.gravity = Gravity.CENTER_VERTICAL
    payload.exLeading?.let { row.addView(renderer.render(it), renderer.rootParams(it)) }
    val center = FrameLayout(ctx)
    payload.exCenter?.let { center.addView(renderer.render(it), FrameLayout.LayoutParams(-2, -2, Gravity.CENTER)) }
    row.addView(center, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
      marginStart = ctx.dp(8)
      marginEnd = ctx.dp(8)
    })
    payload.exTrailing?.let { row.addView(renderer.render(it), renderer.rootParams(it)) }
    column.addView(row, LinearLayout.LayoutParams(-1, -2))

    payload.exBottom?.let {
      column.addView(renderer.render(it), LinearLayout.LayoutParams(-1, -2).apply { topMargin = ctx.dp(10) })
    }
    return column
  }

  private fun animateRadius(target: Float, animate: Boolean) {
    val bg = pillBackground ?: return
    val from = bg.cornerRadius
    if (!animate || from == target) {
      bg.cornerRadius = target
      return
    }
    ValueAnimator.ofFloat(from, target).apply {
      duration = ANIM_MS
      addUpdateListener { bg.cornerRadius = it.animatedValue as Float }
      start()
    }
  }

  @SuppressLint("ClickableViewAccessibility")
  private fun attach(ctx: Context, wm: WindowManager, geo: Geometry) {
    context = ctx
    windowManager = wm

    val root = LinearLayout(ctx)
    root.orientation = LinearLayout.HORIZONTAL
    root.gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
    root.clipChildren = false
    root.clipToPadding = false

    val placeholder = View(ctx)
    val pill = FrameLayout(ctx)
    val background = GradientDrawable().apply {
      setColor(ISLAND_COLOR)
      cornerRadius = geo.compactHeight / 2f
    }
    pill.background = background
    pill.clipToOutline = true
    pill.elevation = ctx.dpf(4.0)
    val bubble = FrameLayout(ctx)
    bubble.background = GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(ISLAND_COLOR)
    }

    val gap = ctx.dp(8)
    root.addView(placeholder, LinearLayout.LayoutParams(0, 0).apply { marginEnd = gap })
    root.addView(pill, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, geo.compactHeight))
    root.addView(bubble, LinearLayout.LayoutParams(0, 0).apply { marginStart = gap })
    placeholder.visibility = View.GONE
    bubble.visibility = View.GONE

    val detector = GestureDetector(ctx, object : GestureDetector.SimpleOnGestureListener() {
      override fun onDown(e: MotionEvent) = true

      override fun onSingleTapUp(e: MotionEvent): Boolean {
        val entry = frontId?.let { ActivityRegistry[it] } ?: return true
        if (entry.payload.hasExpanded) {
          expanded = !expanded
          refresh(ctx)
        } else {
          openApp(ctx, entry)
        }
        return true
      }

      override fun onLongPress(e: MotionEvent) {
        frontId?.let { ActivityRegistry[it] }?.let { openApp(ctx, it) }
      }

      override fun onFling(e1: MotionEvent?, e2: MotionEvent, velocityX: Float, velocityY: Float): Boolean {
        val dy = e2.rawY - (e1?.rawY ?: e2.rawY)
        if (expanded && (velocityY < -600 || dy < -ctx.dp(30)) && abs(dy) > abs(e2.rawX - (e1?.rawX ?: e2.rawX))) {
          expanded = false
          refresh(ctx)
        }
        return true
      }
    })
    pill.setOnTouchListener { _, event -> detector.onTouchEvent(event) }
    // Touches on the strip below the pill (root padding) behave like touches on the pill.
    root.setOnTouchListener { _, event -> detector.onTouchEvent(event) }
    bubble.setOnClickListener {
      val id = bubbleId ?: return@setOnClickListener
      ActivityRegistry.promote(id)
      expanded = false
      refresh(ctx)
    }

    @Suppress("DEPRECATION")
    val params = WindowManager.LayoutParams(
      ViewGroup.LayoutParams.WRAP_CONTENT,
      ViewGroup.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    )
    // Positioned from the left edge so the island can follow off-center cameras while being
    // clamped inside the screen (see the layout listener below).
    params.gravity = Gravity.TOP or Gravity.START
    params.x = geo.centerX
    params.y = (geo.centerY - geo.compactHeight / 2).coerceAtLeast(0)
    if (Build.VERSION.SDK_INT >= 30) {
      params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
    } else if (Build.VERSION.SDK_INT >= 28) {
      params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
    }
    params.windowAnimations = 0

    wm.addView(root, params)
    val margin = ctx.dp(8)
    root.addOnLayoutChangeListener { _, left, _, right, _, _, _, _, _ ->
      val width = right - left
      val x = (geo.centerX - width / 2).coerceIn(margin, max(margin, geo.screenWidth - width - margin))
      if (params.x != x && root.isAttachedToWindow) {
        params.x = x
        wm.updateViewLayout(root, params)
      }
    }
    this.root = root
    this.placeholder = placeholder
    this.pill = pill
    this.bubble = bubble
    this.pillBackground = background
    this.params = params

    // Pop in from the camera
    pill.scaleX = 0.6f
    pill.scaleY = 0.6f
    pill.alpha = 0f
    pill.animate().scaleX(1f).scaleY(1f).alpha(1f)
      .setInterpolator(OvershootInterpolator(1.2f)).setDuration(ANIM_MS).start()
  }

  private fun openApp(ctx: Context, entry: ActivityRegistry.Entry) {
    ActivityRegistry.openAppIntent(ctx, entry.payload.url)?.let {
      try {
        ctx.startActivity(it)
      } catch (_: Exception) {
        // background activity start can be blocked; nothing else to do
      }
    }
  }

  fun hide() {
    val root = root ?: return
    val wm = windowManager
    this.root = null
    pill = null
    bubble = null
    placeholder = null
    pillBackground = null
    frontId = null
    bubbleId = null
    expanded = false
    root.animate().alpha(0f).scaleX(0.8f).scaleY(0.8f).setDuration(200).withEndAction {
      try {
        wm?.removeView(root)
      } catch (_: Exception) {
      }
    }.start()
  }
}
