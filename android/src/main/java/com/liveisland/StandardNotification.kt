package com.liveisland

import androidx.core.app.NotificationCompat

/**
 * The activity drawn with the system notification template only (no RemoteViews), so SystemUI can
 * always inflate it. Derived from the template so apps don't write it twice:
 *  - title: first Text of the lock-screen view (else the expanded / compact regions), or the template name
 *  - text: the remaining Texts joined with " · "
 *  - first Timer → the notification chronometer (counts up from `from`, or down to `to`)
 *  - first Progress → the notification progress bar
 */
object StandardNotification {
  private class Summary {
    val texts = mutableListOf<String>()
    var timerFrom: Long? = null
    var timerTo: Long? = null
    var progress: Float? = null
  }

  fun apply(builder: NotificationCompat.Builder, entry: ActivityRegistry.Entry) {
    val payload = entry.payload
    val summary = Summary()
    val roots = listOfNotNull(payload.ls).ifEmpty {
      listOfNotNull(payload.nc).ifEmpty {
        listOfNotNull(payload.exCenter, payload.exLeading, payload.exTrailing, payload.exBottom, payload.cpLeading, payload.cpTrailing)
      }
    }
    roots.forEach { collect(it, summary) }

    builder.setContentTitle(summary.texts.firstOrNull() ?: entry.name)
    summary.texts.drop(1).joinToString(" · ").takeIf { it.isNotEmpty() }?.let {
      builder.setContentText(it)
      builder.setStyle(NotificationCompat.BigTextStyle().bigText(it))
    }
    val to = summary.timerTo
    val from = summary.timerFrom
    when {
      to != null -> builder.setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true).setWhen(to)
      from != null -> builder.setShowWhen(true).setUsesChronometer(true).setWhen(from)
    }
    summary.progress?.let { builder.setProgress(1000, (it.coerceIn(0f, 1f) * 1000).toInt(), false) }
  }

  private fun collect(node: WireNode, summary: Summary) {
    when (node.t) {
      "tx" -> node.str("v")?.trim()?.takeIf { it.isNotEmpty() }?.let { summary.texts += it }
      "tm" -> if (summary.timerFrom == null && summary.timerTo == null) {
        node.dbl("e")?.let { summary.timerTo = it.toLong() } ?: node.dbl("f")?.let { summary.timerFrom = it.toLong() }
      }
      "pg" -> if (summary.progress == null) {
        val f = node.dbl("f")
        val e = node.dbl("e")
        summary.progress = if (f != null && e != null) timedFraction(f, e) else node.float("v") ?: 0f
      }
    }
    node.children.forEach { collect(it, summary) }
  }
}
