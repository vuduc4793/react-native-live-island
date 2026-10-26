package com.liveisland

import android.Manifest
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.modules.core.PermissionAwareActivity
import java.io.ByteArrayOutputStream
import java.util.UUID

/**
 * Android side of react-native-live-island (contract: src/specs/NativeLiveIsland.ts).
 * An activity = ongoing notification (lock screen / shade), optionally hosted by the foreground
 * service LiveIslandService, plus an optional floating island overlay.
 */
class LiveIslandModule(reactContext: ReactApplicationContext) : NativeLiveIslandSpec(reactContext) {
  companion object {
    const val NAME = NativeLiveIslandSpec.NAME
    private const val NOTIFICATION_PERMISSION_REQUEST = 0x4c49 // "LI"

    /** Registered by the JS side (AppRegistry.registerHeadlessTask), a promise that never settles. */
    const val KEEP_ALIVE_TASK = "LiveIslandKeepAlive"
  }

  /** Headless JS task held while the foreground service runs, see keepJsAlive(). */
  private var keepAliveTaskId: Int? = null

  private val context: Context
    get() = reactApplicationContext.applicationContext

  init {
    ActivityRegistry.emitter = { body ->
      try {
        emitOnActivityStateChange(Arguments.makeNativeMap(body))
      } catch (_: Exception) {
        // JS not ready / torn down
      }
    }
    LiveIslandService.onHostChanged = { id -> keepJsAlive(id != null) }
    val ctx = context
    UiThreadUtil.runOnUiThread {
      NotificationGuard.checkPreviousRun(ctx)
      LiveNotifications.cancelOrphans(ctx)
      keepJsAlive(LiveIslandService.hostedId != null)
      LiveNotifications.registerDismissReceiver(ctx) { id ->
        ActivityRegistry.main.post {
          val entry = ActivityRegistry[id] ?: return@post
          // A run hosted by the foreground service must keep its notification.
          if (LiveIslandService.restoreIfHosted(ctx, entry)) return@post
          ActivityRegistry.remove(id)
          IslandOverlay.refresh(ctx)
          ActivityRegistry.emit(entry, "dismissed")
        }
      }
    }
  }

  override fun invalidate() {
    ActivityRegistry.emitter = null
    LiveIslandService.onHostChanged = null
    UiThreadUtil.runOnUiThread { keepJsAlive(false) }
    super.invalidate()
  }

  /**
   * React Native pauses JS timers (setTimeout / setInterval) once the app is in the background,
   * unless a headless JS task is running. A run tracked by the foreground service needs them
   * (periodic saves, notification updates), so hold a never-ending headless task meanwhile, like
   * react-native-background-actions does. Main thread.
   */
  private fun keepJsAlive(enabled: Boolean) {
    val tasks = HeadlessJsTaskContext.getInstance(reactApplicationContext)
    val running = keepAliveTaskId
    if (enabled && running == null) {
      keepAliveTaskId = try {
        tasks.startTask(HeadlessJsTaskConfig(KEEP_ALIVE_TASK, Arguments.createMap(), 0, true))
      } catch (e: Exception) {
        android.util.Log.w("LiveIsland", "Could not start the keep-alive JS task: ${e.message}")
        null
      }
    } else if (!enabled && running != null) {
      keepAliveTaskId = null
      if (tasks.isTaskRunning(running)) tasks.finishTask(running)
    }
  }

  private fun onMain(promise: Promise, block: () -> Any?) {
    UiThreadUtil.runOnUiThread {
      try {
        promise.resolve(block())
      } catch (e: Exception) {
        promise.reject("E_LIVE_ISLAND", e.message, e)
      }
    }
  }

  private fun ReadableMap.string(key: String) = if (hasKey(key) && !isNull(key)) getString(key) else null
  private fun ReadableMap.number(key: String) = if (hasKey(key) && !isNull(key)) getDouble(key) else null
  private fun ReadableMap.bool(key: String) = hasKey(key) && !isNull(key) && getBoolean(key)

  override fun areActivitiesEnabled(): Boolean = NotificationManagerCompat.from(context).areNotificationsEnabled()

  override fun startActivity(name: String, payload: String, options: ReadableMap, promise: Promise) {
    val parsed = try {
      WirePayload.parse(payload)
    } catch (e: Exception) {
      promise.reject("E_PAYLOAD", e.message, e)
      return
    }
    onMain(promise) {
      val ctx = context
      val entry = ActivityRegistry.Entry(
        id = UUID.randomUUID().toString(),
        name = name,
        payload = parsed,
        overlayRequested = options.bool("overlay"),
        foregroundType = LiveIslandService.typeOf(options.string("foregroundService")) ?: 0,
        standardOnly = options.string("notificationStyle") == "standard",
      )
      ActivityRegistry.put(entry)
      // Post first: the service then takes over the same notification id, and if it can't start
      // the plain notification simply stays.
      LiveNotifications.post(ctx, entry)
      if (entry.foregroundType != 0) LiveIslandService.host(ctx, entry)
      val overlay = entry.overlayRequested && IslandOverlay.canDraw(ctx)
      if (overlay) IslandOverlay.refresh(ctx)
      Arguments.createMap().apply {
        putString("id", entry.id)
        putBoolean("overlay", overlay)
      }
    }
  }

  override fun updateActivity(id: String, payload: String, options: ReadableMap, promise: Promise) {
    onMain(promise) {
      val ctx = context
      val entry = ActivityRegistry[id] ?: return@onMain null
      entry.payload = WirePayload.parse(payload)
      LiveNotifications.post(ctx, entry)
      if (entry.overlayRequested) IslandOverlay.refresh(ctx)
      null
    }
  }

  override fun endActivity(id: String, payload: String?, options: ReadableMap, promise: Promise) {
    onMain(promise) {
      val ctx = context
      val entry = ActivityRegistry[id] ?: return@onMain null
      payload?.let { entry.payload = WirePayload.parse(it) }
      when (options.string("dismissal")) {
        "after" -> {
          val at = options.number("dismissAt")?.toLong() ?: System.currentTimeMillis()
          // Show the final state until the dismissal time, as a normal notification.
          LiveNotifications.post(ctx, entry)
          LiveIslandService.release(ctx, id, keepNotification = true)
          if (entry.overlayRequested) IslandOverlay.refresh(ctx)
          ActivityRegistry.emit(entry, "ended")
          ActivityRegistry.schedule(id, at - System.currentTimeMillis()) {
            ActivityRegistry.remove(id)
            LiveNotifications.cancel(ctx, id)
            IslandOverlay.refresh(ctx)
            ActivityRegistry.emit(entry, "dismissed")
          }
        }
        else -> ActivityRegistry.end(ctx, entry, "ended")
      }
      null
    }
  }

  override fun endAllActivities(promise: Promise) {
    onMain(promise) {
      ActivityRegistry.endAll(context, "ended")
      null
    }
  }

  override fun getActivities(): WritableArray = Arguments.createArray().apply {
    ActivityRegistry.all().forEach {
      pushMap(
        Arguments.createMap().apply {
          putString("id", it.id)
          putString("name", it.name)
          putString("state", it.state)
        },
      )
    }
  }

  override fun hasOverlayPermission(): Boolean = IslandOverlay.canDraw(context)

  override fun requestOverlayPermission(promise: Promise) {
    onMain(promise) {
      val ctx = context
      if (!Settings.canDrawOverlays(ctx)) {
        val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        (reactApplicationContext.currentActivity ?: ctx).startActivity(intent)
      }
      null
    }
  }

  override fun requestNotificationPermission(promise: Promise) {
    if (Build.VERSION.SDK_INT < 33 || LiveNotifications.canPost(context)) {
      promise.resolve(NotificationManagerCompat.from(context).areNotificationsEnabled())
      return
    }
    val activity = reactApplicationContext.currentActivity as? PermissionAwareActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }
    UiThreadUtil.runOnUiThread {
      activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION_REQUEST) { code, _, _ ->
        if (code != NOTIFICATION_PERMISSION_REQUEST) return@requestPermissions false
        promise.resolve(LiveNotifications.canPost(context))
        true
      }
    }
  }

  override fun getNotificationHealth(): WritableMap = Arguments.makeNativeMap(NotificationGuard.health(context))

  override fun iconImage(name: String, android: String?, size: Double, color: Double): String? {
    val ctx = context
    val drawable = Icons.drawable(ctx, name, android) ?: return null
    // Same box as the in-app island lays out: size * 1.25, icon fitted inside.
    val px = (size * 1.25 * ctx.resources.displayMetrics.density).toInt()
    val bitmap = Icons.bitmap(drawable, px, px, color.toLong().toInt())
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
    bitmap.recycle()
    return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  }
}
