# The accessibility service is never referenced by name from our own code — Android instantiates
# it from the manifest — so R8 has no call graph reaching it. The default Android rules keep
# `android.app.Service` subclasses and an AccessibilityService is one, but relying on that is
# relying on a default: if it ever changes, the symptom is a service the user can enable in
# Settings that then does nothing at all.
-keep class com.chetan.connectsuite.input.ConnectSuiteInputService { *; }
