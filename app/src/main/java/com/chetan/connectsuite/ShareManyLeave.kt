package com.chetan.connectsuite

/**
 * **What `ShareManyToMacActivity.onStop` does — the rule, with nothing Android in it.** Development only,
 * debug source set. docs/feature-a-multi-offer-proposal.md rev 4 §11 (a shared URI is read only while
 * the screen is alive) and §15 (one file is the single-file sheet, unchanged).
 *
 * Recorded on 2026-09-28 as *"Back … now ended in `onStop` (reasoned, untested)"*; this is where the
 * reasoning became a function a JVM test calls. The activity is still the only caller, so the call
 * site itself is not reached by a test — only the decision is.
 */
internal object ShareManyLeave {

    enum class Action {
        /** A configuration change (rotation): the same screen comes back; nothing ends. */
        STAY,
        /** Several files, leaving without finishing (Home, the recents switch, the screen timing out). */
        END_SELECTION_AND_FINISH,
        /**
         * Several files, already finishing (Back, Close): end the selection **here**, since `onCleared`
         * can trail `onStop` and the queue would go on opening URIs in between. Finishing is under way.
         */
        END_SELECTION,
        /** One file: the single-file sheet's own rule (`ShareToMacActivity.onStop`), unchanged. */
        SINGLE_FILE_RULE,
    }

    fun onStop(changingConfigurations: Boolean, finishing: Boolean, singleFile: Boolean): Action = when {
        changingConfigurations -> Action.STAY
        singleFile -> Action.SINGLE_FILE_RULE
        finishing -> Action.END_SELECTION
        else -> Action.END_SELECTION_AND_FINISH
    }
}
