package com.chetan.connectsuite.camera

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Source scans for the engine and feature wiring that a JVM test cannot run — `CameraEngine` needs a
 * `Context` and `ControlSession`s, and the resume hook needs an `Application`. Each scan names the call it
 * holds; the rules themselves are run for real in `CameraSessionMachineTest` and `CameraHostCoreTest`.
 *
 * A source scan proves the call is written, not that it runs. That limit is the point of saying so.
 */
class CameraWiringTest {

    private fun source(name: String) = File("src/main/java/com/chetan/connectsuite/camera/$name").readText()

    private val engine = source("CameraEngine.kt")
    private val feature = source("CameraFeature.kt")
    private val notifications = source("CameraNotifications.kt")

    @Test
    fun `the request route is decided from what can be delivered, before the machine builds the ack`() {
        val onRequest = engine.substringAfter("fun onRequest(").substringBefore("\n    }\n")
        val decided = onRequest.indexOf("CameraRequestRoute.choose(")
        val deliverable = onRequest.indexOf("CameraNotifications.deliverable(context)")
        val asked = onRequest.indexOf("machine.request(")
        assertTrue("no route decision", decided >= 0)
        assertTrue("the decision does not ask whether a notification can be shown", deliverable > decided)
        assertTrue("the ack is built before the route is decided", asked > decided)
        assertTrue(onRequest.contains("route = route"))
    }

    @Test
    fun `the request is shown by the route the ack named, and each outcome is logged`() {
        assertTrue(engine.contains("is CameraEffect.ShowRequest -> showRequest(effect.streamId, effect.peerName, effect.route)"))
        val show = engine.substringAfter("private fun showRequest(").substringBefore("\n    }\n")
        for (route in CameraRequestRoute.entries) assertTrue("no branch for $route", show.contains("CameraRequestRoute.${route.name} ->"))
        assertTrue(show.contains("notification posted"))
        assertTrue(show.contains("could NOT be posted"))
        assertTrue(show.contains("NOT delivered"))
    }

    @Test
    fun `posting reports whether Android took it, and deliverability checks the app switch and the channel`() {
        assertTrue(notifications.contains("fun askUser(context: Context, peerName: String): Boolean"))
        val deliverable = notifications.substringAfter("fun deliverable(context: Context)").substringBefore("\n    }\n")
        assertTrue(deliverable.contains("areNotificationsEnabled()"))
        assertTrue(deliverable.contains("getNotificationChannel(NotificationChannels.CAMERA_REQUEST)"))
        assertTrue(deliverable.contains("CameraRequestDelivery.deliverable("))
    }

    @Test
    fun `a permission answer is judged on the clock`() {
        assertTrue(engine.contains("run(machine.permissionDenied(streamId, System.currentTimeMillis()))"))
        assertTrue(engine.contains("machine.approve(streamId, facing, System.currentTimeMillis())"))
    }

    @Test
    fun `Sidekick coming to the front shows only a request that has not run out by its own clock`() {
        val hook = feature.substringAfter("private object RequestScreenOnResume").substringBefore("override fun onActivityCreated")
        assertTrue(hook.contains("if (!CameraEngine.requestAwaiting()) return"))
        assertFalse("the hook reads the published state again", hook.contains("ui.value"))
        assertTrue(engine.contains("fun requestAwaiting(): Boolean = machine.isAwaiting(System.currentTimeMillis())"))
    }

    @Test
    fun `nothing in the module starts a foreground service, records sound, or saves a picture`() {
        val all = File("src/main/java/com/chetan/connectsuite/camera").listFiles()!!.joinToString("\n") { it.readText() }
        for (forbidden in listOf("startForegroundService", "startForeground(", "MediaRecorder", "AudioRecord", "ImageCapture", "VideoCapture")) {
            assertFalse("the camera module uses $forbidden", all.contains(forbidden))
        }
    }
}
