package com.liveisland

import android.Manifest
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Foreground service that hosts the notification of ONE activity (started with
 * `androidForegroundService`), so the run / ride / call keeps the process — and JS — alive while the
 * screen is off, with a single notification. The newest activity that asks for it takes over.
 *
 * Started with startService() (not startForegroundService()) while the app is in the foreground:
 * if startForeground() is refused (missing permission, background start), the service simply stops
 * and the activity keeps its plain notification instead of crashing the app.
 */
class LiveIslandService : Service() {
  companion object {
    private const val TAG = "LiveIsland"
    private const val EXTRA_ID = "activityId"

    /** Activity whose notification is the foreground notification right now. */
    var hostedId: String? = null
      private set(value) {
        if (field == value) return
        field = value
        onHostChanged?.invoke(value)
      }

    /** Main thread. The module keeps JS timers running (headless task) while something is hosted. */
    var onHostChanged: ((String?) -> Unit)? = null
    private var instance: LiveIslandService? = null

    /** ServiceInfo.FOREGROUND_SERVICE_TYPE_* for a JS type name, null when unknown. */
    fun typeOf(name: String?): Int? = when (name) {
      "location" -> ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
      "dataSync" -> ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
      "mediaPlayback" -> ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      "connectedDevice" -> ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
      "health" -> ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH
      "shortService" -> ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE
      else -> null
    }

    private fun granted(context: Context, permission: String) =
      ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    /** Android 14+ refuses startForeground() without these; check first to fail soft. */
    private fun missingPermission(context: Context, type: Int): String? {
      if (Build.VERSION.SDK_INT < 34) return null
      val typePermission = when (type) {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION -> Manifest.permission.FOREGROUND_SERVICE_LOCATION
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC -> Manifest.permission.FOREGROUND_SERVICE_DATA_SYNC
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK -> Manifest.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK
        ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE -> Manifest.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE
        ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH -> Manifest.permission.FOREGROUND_SERVICE_HEALTH
        else -> null
      }
      if (typePermission != null && !granted(context, typePermission)) return typePermission
      if (type == ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION &&
        !granted(context, Manifest.permission.ACCESS_FINE_LOCATION) &&
        !granted(context, Manifest.permission.ACCESS_COARSE_LOCATION)
      ) {
        return Manifest.permission.ACCESS_FINE_LOCATION
      }
      return null
    }

    /** Move the activity's notification into the foreground service. False when that isn't possible. */
    fun host(context: Context, entry: ActivityRegistry.Entry): Boolean {
      missingPermission(context, entry.foregroundType)?.let {
        Log.w(TAG, "Not starting the foreground service for '${entry.name}': $it is not granted. Using a plain notification.")
        return false
      }
      return try {
        context.startService(Intent(context, LiveIslandService::class.java).putExtra(EXTRA_ID, entry.id))
        hostedId = entry.id
        true
      } catch (e: Exception) {
        // IllegalStateException: app in the background (Android 8+ start restrictions)
        Log.w(TAG, "Could not start the foreground service for '${entry.name}': ${e.message}. Using a plain notification.")
        false
      }
    }

    /**
     * Stop hosting `id` (no-op for other ids). `keepNotification` leaves the notification posted as a
     * normal one (dismissal "after").
     */
    fun release(context: Context, id: String, keepNotification: Boolean) {
      if (hostedId != id) return
      hostedId = null
      val service = instance
      if (service != null) {
        ServiceCompat.stopForeground(
          service,
          if (keepNotification) ServiceCompat.STOP_FOREGROUND_DETACH else ServiceCompat.STOP_FOREGROUND_REMOVE,
        )
        service.stopSelf()
      } else {
        context.stopService(Intent(context, LiveIslandService::class.java))
      }
    }

    /** The user swiped the hosted notification away (allowed since Android 14): put it back. */
    fun restoreIfHosted(context: Context, entry: ActivityRegistry.Entry): Boolean {
      if (hostedId != entry.id) return false
      try {
        NotificationManagerCompat.from(context)
          .notify(LiveNotifications.notificationId(entry.id), LiveNotifications.build(context, entry))
      } catch (_: SecurityException) {
      }
      return true
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val id = intent?.getStringExtra(EXTRA_ID)
    val entry = id?.let { ActivityRegistry[it] }
    if (entry == null || hostedId != id) {
      // ended (or replaced) before the service got here
      if (hostedId == null) stopSelf()
      return START_NOT_STICKY
    }
    try {
      ServiceCompat.startForeground(
        this,
        LiveNotifications.notificationId(entry.id),
        LiveNotifications.build(this, entry),
        entry.foregroundType,
      )
      // Taking over from another activity cancels its notification: post it again as a plain one.
      ActivityRegistry.all()
        .filter { it.id != entry.id && it.state == "active" }
        .forEach { LiveNotifications.post(this, it) }
    } catch (e: Exception) {
      Log.w(TAG, "startForeground refused for '${entry.name}': ${e.message}. Using a plain notification.")
      hostedId = null
      LiveNotifications.post(this, entry)
      stopSelf()
    }
    return START_NOT_STICKY
  }

  /** App swiped away from Recents: end every activity so no notification outlives the app. */
  override fun onTaskRemoved(rootIntent: Intent?) {
    ActivityRegistry.endAll(applicationContext, "ended")
    hostedId = null
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    super.onDestroy()
  }
}
