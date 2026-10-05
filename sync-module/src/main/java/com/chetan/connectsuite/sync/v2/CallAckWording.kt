package com.chetan.connectsuite.sync.v2

/**
 * The sentences `CallFeature` logs when a call verb is delivered.
 *
 * Here, and not inline, for one reason: [CallFeature] cannot be touched from a JVM unit test —
 * `TelecomManager`, `Context`, the works — and the wording below is the subject of defect 40, so
 * it needs somewhere a test can reach. Same seam as `SmsPayloads` and `CallWatcher.dispositionOf`,
 * per CLAUDE.md: move the pure part out rather than mock the platform.
 *
 * ### Defect 40 — a log line may not name an outcome it does not decide
 *
 * [REJECT_DELIVERED] used to end *"so call.ended will say rejected"*. That is a prediction this
 * code does not get to make. `CallWatcher.dispositionOf` puts `answered` above `rejected`, so a
 * call that connected before the Mac hung up ends as `answered` — and the line had already said
 * otherwise. Step 69 produced exactly that on 2026-08-28, 342 ms apart:
 *
 * ```
 * 23:53:58.243 I [calls] call.reject delivered (rejected — the episode is flagged, so call.ended will say rejected)
 * 23:53:58.585 I [calls] Call c2 ended answered after 4078ms
 * ```
 *
 * The second line is correct and the first is not. It is the failure mode CLAUDE.md's second
 * driving rule names — a clean, specific, confident wrong answer — sitting in the log that step 70
 * asks its reader to trust about `rejected` versus `missed`.
 *
 * So the rule this file holds: **say what was done, and name the rule that decides the rest.**
 * The flag being set is a fact. The disposition is not one yet.
 */
internal object CallAckWording {

    /**
     * Not followed by the number. It used to be — `dialled +15551234567` — and this line is written
     * to `LinkLog`'s file; the phone's own logs carry no numbers (`docs/protocol.md` → Calls). The
     * number is in the request, which is where the Mac that asked for it already has it.
     */
    const val DIAL_DELIVERED = "dialled — the number is not logged"

    const val ANSWER_DELIVERED = "answered — audio stays on the phone"

    /**
     * Names the flag it set, and the precedence that will settle the outcome, without claiming the
     * outcome. `answered outranks the flag` is the part a step-70 reader actually needs: it is why
     * a `rejected` flag can still end `answered`, and why reading this line is not reading the
     * disposition.
     */
    const val REJECT_DELIVERED =
        "rejected — the episode is flagged; call.ended decides the disposition when the call " +
            "ends, and answered outranks the flag"

    /**
     * Wording that would make this line a prediction rather than a report.
     *
     * Checked by a test rather than by review, because the sentence is one careless edit from
     * being wrong again and nothing else in the build would notice.
     */
    val FORBIDDEN_IN_ACKS = listOf("will say", "will be", "will report")
}
