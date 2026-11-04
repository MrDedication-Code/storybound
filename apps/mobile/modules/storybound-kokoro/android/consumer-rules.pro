# ONNX Runtime's native code finds its Java classes and methods by name; keep them as they are
# when release builds shrink and rename code.
-keep class ai.onnxruntime.** { *; }
