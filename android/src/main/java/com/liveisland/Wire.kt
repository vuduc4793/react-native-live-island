package com.liveisland

import android.content.Context
import android.util.TypedValue
import org.json.JSONObject

/** Read-only view over a serialized node of the wire format (src/schema.ts). */
class WireNode(private val json: JSONObject) {
  val t: String = json.optString("t")

  val children: List<WireNode> by lazy {
    val array = json.optJSONArray("c") ?: return@lazy emptyList()
    (0 until array.length()).mapNotNull { array.optJSONObject(it)?.let(::WireNode) }
  }

  fun has(key: String) = json.has(key) && !json.isNull(key)

  fun str(key: String): String? = if (has(key)) json.optString(key) else null

  fun dbl(key: String): Double? = if (has(key)) json.optDouble(key).takeUnless { it.isNaN() } else null

  fun float(key: String): Float? = dbl(key)?.toFloat()

  /** Colors travel as unsigned ARGB; wrapping to Int gives the Android color int. */
  fun color(key: String): Int? = if (has(key)) json.optLong(key).toInt() else null

  fun flag(key: String) = json.optInt(key, 0) == 1

  /** [top, right, bottom, left] */
  val padding: DoubleArray? by lazy {
    val array = json.optJSONArray("p") ?: return@lazy null
    if (array.length() != 4) null else DoubleArray(4) { array.optDouble(it, 0.0) }
  }

  val fill get() = flag("fx")
}

class WirePayload(json: JSONObject) {
  val ls = json.node("ls")
  val exLeading: WireNode?
  val exTrailing: WireNode?
  val exCenter: WireNode?
  val exBottom: WireNode?
  val cpLeading: WireNode?
  val cpTrailing: WireNode?
  val mn = json.node("mn")
  val nc = json.node("nc")
  val background: Int?
  val keyline: Int?
  val textColor: Int?
  val url: String? = json.optString("url").takeIf { json.has("url") && it.isNotEmpty() }

  init {
    val ex = json.optJSONObject("ex")
    exLeading = ex?.node("l")
    exTrailing = ex?.node("t")
    exCenter = ex?.node("c")
    exBottom = ex?.node("b")
    val cp = json.optJSONObject("cp")
    cpLeading = cp?.node("l")
    cpTrailing = cp?.node("t")
    val st = json.optJSONObject("st")
    background = st?.colorOrNull("bg")
    keyline = st?.colorOrNull("kl")
    textColor = st?.colorOrNull("fc")
  }

  val hasExpanded get() = exLeading != null || exTrailing != null || exCenter != null || exBottom != null

  companion object {
    fun parse(raw: String): WirePayload = WirePayload(JSONObject(raw))

    private fun JSONObject.node(key: String) = optJSONObject(key)?.let(::WireNode)

    private fun JSONObject.colorOrNull(key: String) = if (has(key) && !isNull(key)) optLong(key).toInt() else null
  }
}

fun Context.dp(value: Double): Int =
  TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

fun Context.dp(value: Int): Int = dp(value.toDouble())

fun Context.dpf(value: Double): Float =
  TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics)
