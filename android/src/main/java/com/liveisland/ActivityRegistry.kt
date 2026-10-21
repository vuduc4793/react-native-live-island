package com.liveisland

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper

/**
 * Process-wide store of running activities, so state survives module re-creation
 * (e.g. JS reloads). All access happens on the main thread.
 */
object ActivityRegistry {
  class Entry(
    val id: String,
    val name: String,
    var payload: WirePayload,
    /** the caller asked for the floating island */
    val overlayRequested: Boolean,
    /** ServiceInfo.FOREGROUND_SERVICE_TYPE_* to host the notification in LiveIslandService, 0 = plain notification */
    val foregroundType: Int = 0,
  ) {
    var state = "active"
  }

  /** Insertion order = recency; the last entry is the one shown in the island. */
  private val entries = LinkedHashMap<String, Entry>()
  private val pendingCancels = HashMap<String, Runnable>()

  val main = Handler(Looper.getMainLooper())

  /** Set by the module to forward state changes to JS. */
  var emitter: ((Map<String, Any?>) -> Unit)? = null

  fun all(): List<Entry> = entries.values.toList()

  operator fun get(id: String) = entries[id]

  fun put(entry: Entry) {
    entries[entry.id] = entry
  }

  /** Move an activity to the front of the island. */
  fun promote(id: String) {
    val entry = entries.remove(id) ?: return
    entries[id] = entry
  }

  fun remove(id: String): Entry? {
    pendingCancels.remove(id)?.let { main.removeCallbacks(it) }
    return entries.remove(id)
  }

  fun schedule(id: String, delayMs: Long, block: () -> Unit) {
    pendingCancels.remove(id)?.let { main.removeCallbacks(it) }
    val runnable = Runnable {
      pendingCancels.remove(id)
      block()
    }
    pendingCancels[id] = runnable
    main.postDelayed(runnable, delayMs.coerceAtLeast(0))
  }

  /** End an activity now: notification, floating island and foreground service. Main thread. */
  fun end(context: Context, entry: Entry, state: String) {
    remove(entry.id)
    LiveIslandService.release(context, entry.id, keepNotification = false)
    LiveNotifications.cancel(context, entry.id)
    IslandOverlay.refresh(context)
    emit(entry, state)
  }

  fun endAll(context: Context, state: String) {
    all().forEach { end(context, it, state) }
  }

  fun emit(entry: Entry, state: String) {
    entry.state = state
    emitter?.invoke(mapOf("id" to entry.id, "name" to entry.name, "state" to state))
  }

  /** Intent that opens the host app, optionally on the activity's deep link. */
  fun openAppIntent(context: Context, url: String?): Intent? {
    val pkg = context.packageName
    if (url != null) {
      val view = Intent(Intent.ACTION_VIEW, Uri.parse(url)).setPackage(pkg)
      if (view.resolveActivity(context.packageManager) != null) {
        return view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      }
    }
    return context.packageManager.getLaunchIntentForPackage(pkg)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      url?.let { data = Uri.parse(it) }
    }
  }
}
