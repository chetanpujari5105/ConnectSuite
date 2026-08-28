# Room generates implementations reflectively at runtime.
-keep class * extends androidx.room.RoomDatabase { *; }
-keep @androidx.room.Entity class * { *; }
-dontwarn androidx.room.paging.**

# kotlinx.serialization keeps its generated serializers on the companion / synthetic members.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.chetan.connectsuite.**$$serializer { *; }
-keepclassmembers class com.chetan.connectsuite.** {
    *** Companion;
}
-keepclasseswithmembers class com.chetan.connectsuite.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Services and receivers are instantiated by name from the manifest.
-keep class com.chetan.connectsuite.core.service.ConnectionService { *; }
-keep class com.chetan.connectsuite.sync.notifications.NotificationMirrorService { *; }
-keep class com.chetan.connectsuite.sync.sms.SmsMirrorReceiver { *; }

# The capture server is a dex asset, never linked into the app - but its entry point name is
# referenced as a string when starting it over ADB.
-keepnames class com.chetan.connectsuite.server.** { *; }
