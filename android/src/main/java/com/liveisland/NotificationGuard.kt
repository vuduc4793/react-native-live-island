package com.liveisland

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.FrameLayout
import android.widget.RemoteViews

/**
 * Keeps custom (RemoteViews) notifications from killing the app.
 *
 * When SystemUI can't inflate a notification it drops it silently, except for a foreground service
 * notification: then the system crashes the app (RemoteServiceException "Bad notification … Couldn't
 * inflate contentViews", CannotPostForegroundServiceNotificationException on Android 12+). That
 * exception is thrown asynchronously on the main looper, so try/catch around startForeground() can't
 * stop it. Two defences:
 *  1. [inflates]: apply the RemoteViews locally first. It runs the same framework code SystemUI runs
 *     on this ROM, so non-remotable methods / views are caught here and we post the standard template.
 *  2. A tripwire for what (1) can't see (OEM SystemUI quirks): before posting a custom foreground
 *     notification, mark "posting" in prefs and clear it a few seconds later. If the next process
 *     finds the mark (and, on Android 11+, the exit reason was a crash), custom views are blocked for
 *     this app version and foreground notifications use the standard template from then on.
 */
object NotificationGuard {
  private const val TAG = "LiveIsland"
  private const val PREFS = "com.liveisland.notification_guard"
  private const val KEY_PENDING = "pendingSince"
  private const val KEY_BLOCKED_VERSION = "blockedVersion"
  private const val KEY_BLOCKED_AT = "blockedAt"
  private const val KEY_BLOCKED_REASON = "blockedReason"
  private const val WINDOW_MS = 8_000L

  private val main = Handler(Looper.getMainLooper())
  private val clear = Runnable { appContext?.let { clearPending(it) } }
  private var appContext: Context? = null
  private var checked = false

  /** Last reason a notification fell back to the standard template in this process. */
  var lastFallback: String? = null
    private set

  private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun appVersion(context: Context): Long = try {
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
  } catch (_: Exception) {
    -1L
  }

  /** Custom views may be used for foreground notifications (not tripped for this app version). */
  fun customAllowed(context: Context): Boolean {
    checkPreviousRun(context)
    return prefs(context).getLong(KEY_BLOCKED_VERSION, Long.MIN_VALUE) != appVersion(context)
  }

  /** True when [views] inflate on this device; otherwise remembers why and returns false. */
  fun inflates(context: Context, views: RemoteViews, what: String): Boolean = try {
    views.apply(context, FrameLayout(context))
    true
  } catch (e: Throwable) {
    if (e is VirtualMachineError) throw e
    fallback("$what doesn't inflate on this device: ${e.message}")
    false
  }

  fun fallback(reason: String) {
    if (lastFallback != reason) Log.w(TAG, "Using the standard notification template. $reason")
    lastFallback = reason
  }

  /** Call right before posting a custom-view notification that is (or may become) a foreground one. */
  fun arm(context: Context) {
    appContext = context.applicationContext
    // commit(): the crash we guard against can follow within milliseconds, an async write could be lost.
    if (!prefs(context).contains(KEY_PENDING)) prefs(context).edit().putLong(KEY_PENDING, System.currentTimeMillis()).commit()
    main.removeCallbacks(clear)
    main.postDelayed(clear, WINDOW_MS)
  }

  /** Normal end of a foreground notification (ended, released, app swiped away). */
  fun clearPending(context: Context) {
    main.removeCallbacks(clear)
    if (prefs(context).contains(KEY_PENDING)) prefs(context).edit().remove(KEY_PENDING).commit()
  }

  /** Once per process: did the previous one die while posting a custom foreground notification? */
  fun checkPreviousRun(context: Context) {
    if (checked) return
    checked = true
    val prefs = prefs(context)
    val since = prefs.getLong(KEY_PENDING, 0L)
    if (since == 0L) return
    prefs.edit().remove(KEY_PENDING).commit()
    if (!diedFromCrash(context, since)) return
    val reason = "the app was killed while posting a custom foreground notification"
    Log.w(TAG, "Custom notification views are disabled for this app version: $reason.")
    prefs.edit()
      .putLong(KEY_BLOCKED_VERSION, appVersion(context))
      .putLong(KEY_BLOCKED_AT, System.currentTimeMillis())
      .putString(KEY_BLOCKED_REASON, reason)
      .commit()
  }

  /** Android 11+ records why the last process ended; older versions: assume the worst. */
  private fun diedFromCrash(context: Context, since: Long): Boolean {
    if (Build.VERSION.SDK_INT < 30) return true
    return try {
      val am = context.getSystemService(ActivityManager::class.java) ?: return true
      val exit = am.getHistoricalProcessExitReasons(context.packageName, 0, 5)
        .firstOrNull { it.timestamp >= since - 1_000 } ?: return true
      exit.reason == ApplicationExitInfo.REASON_CRASH || exit.reason == ApplicationExitInfo.REASON_CRASH_NATIVE
    } catch (_: Exception) {
      true
    }
  }

  /** Reported to JS by getNotificationHealth(). */
  fun health(context: Context): Map<String, Any?> {
    val prefs = prefs(context)
    val blocked = !customAllowed(context)
    return mapOf(
      "customViews" to if (blocked) "blocked" else "allowed",
      "blockedAt" to if (blocked) prefs.getLong(KEY_BLOCKED_AT, 0L).toDouble() else null,
      "reason" to if (blocked) prefs.getString(KEY_BLOCKED_REASON, null) else lastFallback,
    )
  }
}
