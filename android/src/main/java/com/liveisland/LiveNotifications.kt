package com.liveisland

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** The Android counterpart of the lock-screen Live Activity: an ongoing, silent notification. */
object LiveNotifications {
  const val CHANNEL_ID = "dynamic_island"
  private const val ACTION_DISMISSED = "com.liveisland.ACTION_DISMISSED"
  private const val EXTRA_ID = "activityId"
  private var receiverRegistered = false

  fun notificationId(activityId: String) = activityId.hashCode()

  fun canPost(context: Context): Boolean {
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      return false
    }
    return NotificationManagerCompat.from(context).areNotificationsEnabled()
  }

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = context.getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "Live Activities", NotificationManager.IMPORTANCE_DEFAULT).apply {
      description = "Ongoing activities such as deliveries, timers and calls"
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  /** Listen for the user swiping the notification away (allowed for ongoing ones since Android 14). */
  fun registerDismissReceiver(context: Context, onDismiss: (String) -> Unit) {
    if (receiverRegistered) return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context, intent: Intent) {
        intent.getStringExtra(EXTRA_ID)?.let(onDismiss)
      }
    }
    ContextCompat.registerReceiver(
      context.applicationContext,
      receiver,
      IntentFilter(ACTION_DISMISSED),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
    receiverRegistered = true
  }

  private fun smallIcon(context: Context): Int =
    Icons.appDrawable(context, "notification_icon").takeIf { it != 0 } ?: R.drawable.di_ic_bell

  fun post(context: Context, entry: ActivityRegistry.Entry) {
    if (!canPost(context)) return
    try {
      NotificationManagerCompat.from(context).notify(notificationId(entry.id), build(context, entry))
    } catch (_: SecurityException) {
      // permission revoked between the check and the post
    }
  }

  /** The notification of one activity. Also used as the foreground service notification. */
  fun build(context: Context, entry: ActivityRegistry.Entry): Notification {
    ensureChannel(context)
    val payload = entry.payload

    val requestCode = notificationId(entry.id)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val content = ActivityRegistry.openAppIntent(context, payload.url)?.let {
      PendingIntent.getActivity(context, requestCode, it, flags)
    }
    val dismiss = PendingIntent.getBroadcast(
      context,
      requestCode,
      Intent(ACTION_DISMISSED).setPackage(context.packageName).putExtra(EXTRA_ID, entry.id),
      flags,
    )

    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(entry.name)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setShowWhen(false)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setDeleteIntent(dismiss)
    content?.let { builder.setContentIntent(it) }
    (payload.keyline ?: payload.background)?.let { builder.setColor(it) }

    // A foreground notification that SystemUI can't inflate kills the app, see NotificationGuard.
    val foreground = entry.foregroundType != 0
    val custom = when {
      entry.standardOnly -> null
      foreground && !NotificationGuard.customAllowed(context) -> {
        NotificationGuard.fallback("custom views were disabled after a crash on this device")
        null
      }
      else -> customViews(context, entry)
    }
    if (custom != null) {
      builder.setStyle(NotificationCompat.DecoratedCustomViewStyle()).setCustomContentView(custom.first)
      custom.second?.let { builder.setCustomBigContentView(it) }
      if (foreground) NotificationGuard.arm(context)
    } else {
      StandardNotification.apply(builder, entry)
    }
    if (foreground) {
      builder.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
    }
    return builder.build()
  }

  /** Collapsed + expanded RemoteViews, or null when rendering / inflating them fails on this device. */
  private fun customViews(context: Context, entry: ActivityRegistry.Entry): Pair<RemoteViews, RemoteViews?>? {
    val payload = entry.payload
    return try {
      val renderer = RemoteViewsRenderer(context, payload.textColor)
      val collapsed = payload.nc?.let { renderer.root(it, payload.background) }
        ?: renderer.compactRow(payload.cpLeading, payload.cpTrailing, payload.background)
      val expanded = payload.ls?.let { renderer.root(it, payload.background) }
      if (!NotificationGuard.inflates(context, collapsed, "collapsed view of '${entry.name}'")) return null
      if (expanded != null && !NotificationGuard.inflates(context, expanded, "expanded view of '${entry.name}'")) return null
      collapsed to expanded
    } catch (e: Exception) {
      NotificationGuard.fallback("rendering '${entry.name}' failed: ${e.message}")
      null
    }
  }

  fun cancel(context: Context, activityId: String) {
    NotificationManagerCompat.from(context).cancel(notificationId(activityId))
  }

  /**
   * Remove our notifications that no running activity owns, left over when a previous process died
   * (the registry lives in memory). Notifications of activities still in the registry (JS reload) stay.
   */
  fun cancelOrphans(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    val live = ActivityRegistry.all().map { notificationId(it.id) }.toSet()
    manager.activeNotifications
      .filter { it.notification.channelId == CHANNEL_ID && it.id !in live }
      .forEach { manager.cancel(it.tag, it.id) }
  }
}
